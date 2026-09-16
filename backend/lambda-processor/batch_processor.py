"""
Batch Processor for Long-Running PDF Reports

Implements queue-based batch processing with checkpoint/resume capability.
Based on 2026 AWS serverless best practices for handling 15-minute Lambda timeouts.

Pattern:
1. Each Lambda invocation processes one batch (e.g., 2 chunks)
2. State saved to R2 after each batch
3. Next batch triggered via recursive Lambda invocation or SQS
4. Can resume from last checkpoint on failure
"""

import json
import time
from typing import Dict, Any, List, Optional, Tuple
from datetime import datetime
import boto3

from job_state import JobState, JobStateManager, JobPhase
from structured_logger import StructuredLogger


class BatchConfig:
    """Configuration for batch processing"""

    def __init__(self):
        # Process 2 chunks per batch to stay under 12-min Lambda runtime
        self.chunks_per_batch = 2

        # Time budget per Lambda invocation (12 minutes, leaving 3-min buffer)
        self.max_batch_duration_seconds = 720  # 12 minutes

        # Rate limiting between chunks
        self.chunk_delay_seconds = 20

        # Retry configuration
        self.max_retries = 3
        self.retry_delay_seconds = 30


class BatchProcessor:
    """
    Orchestrates multi-batch processing of large PDFs

    Each batch:
    1. Loads job state from R2
    2. Processes assigned chunks
    3. Saves checkpoint to R2
    4. Triggers next batch (if needed)
    """

    def __init__(
        self,
        s3_client,
        bucket: str,
        lambda_client=None,
        lambda_function_name: str = None
    ):
        self.s3_client = s3_client
        self.bucket = bucket
        self.lambda_client = lambda_client
        self.lambda_function_name = lambda_function_name
        self.config = BatchConfig()
        self.state_manager = JobStateManager(s3_client, bucket)

    def get_chunks_for_batch(
        self,
        batch_num: int,
        total_chunks: int
    ) -> Tuple[int, int]:
        """Calculate chunk range for this batch"""
        chunks_per_batch = self.config.chunks_per_batch
        start_chunk = batch_num * chunks_per_batch
        end_chunk = min(start_chunk + chunks_per_batch, total_chunks)
        return start_chunk, end_chunk

    def should_continue(
        self,
        start_time: float,
        logger: StructuredLogger
    ) -> bool:
        """
        Check if we should continue processing or yield to next batch

        AWS Best Practice: Gracefully shutdown Lambda before timeout
        """
        elapsed = time.time() - start_time

        if elapsed > self.config.max_batch_duration_seconds:
            logger.warning(
                f"Approaching Lambda timeout ({elapsed:.0f}s), yielding to next batch",
                phase="batch_control"
            )
            return False

        return True

    def trigger_next_batch(
        self,
        job_state: JobState,
        logger: StructuredLogger
    ) -> bool:
        """
        Trigger next batch via async Lambda invocation

        Alternative: Use SQS queue for more robust queueing
        """
        if not self.lambda_client or not self.lambda_function_name:
            logger.error(
                "Lambda client not configured, cannot trigger next batch",
                phase="batch_trigger"
            )
            return False

        try:
            # Prepare payload for next invocation
            payload = {
                'mode': 'resume_batch',
                'jobId': job_state.job_id,
                'reportId': job_state.report_id,
                'householdId': job_state.household_id,
                'batchNum': job_state.current_batch + 1
            }

            # Async invocation (fire and forget)
            response = self.lambda_client.invoke(
                FunctionName=self.lambda_function_name,
                InvocationType='Event',  # Async
                Payload=json.dumps(payload)
            )

            logger.info(
                f"Triggered batch {job_state.current_batch + 1}",
                phase="batch_trigger",
                status_code=response['StatusCode']
            )

            return response['StatusCode'] == 202

        except Exception as e:
            logger.error(
                f"Failed to trigger next batch: {str(e)}",
                phase="batch_trigger",
                exception=e
            )
            return False

    def process_chunk_batch(
        self,
        job_state: JobState,
        chunks: List[bytes],
        process_chunk_fn: callable,
        logger: StructuredLogger,
        start_time: float
    ) -> Tuple[List[Dict], Dict[str, int]]:
        """
        Process a batch of chunks with rate limiting

        Args:
            job_state: Current job state
            chunks: List of PDF chunks to process
            process_chunk_fn: Function to process each chunk
            logger: Structured logger
            start_time: Batch start time

        Returns:
            (findings, total_usage)
        """
        batch_start_idx, batch_end_idx = self.get_chunks_for_batch(
            job_state.current_batch,
            len(chunks)
        )

        all_findings = []
        total_usage = {
            'input_tokens': 0,
            'output_tokens': 0,
            'cache_creation_tokens': 0,
            'cache_read_tokens': 0
        }

        logger.info(
            f"Processing chunk batch {job_state.current_batch + 1}",
            phase="batch_start",
            chunks_range=f"{batch_start_idx}-{batch_end_idx}",
            total_chunks=len(chunks)
        )

        for idx in range(batch_start_idx, batch_end_idx):
            chunk_num = idx + 1

            # Check time budget
            if not self.should_continue(start_time, logger):
                logger.warning(
                    f"Time budget exceeded, stopping at chunk {chunk_num}",
                    phase="batch_timeout"
                )
                # Save progress and trigger next batch
                job_state.set_checkpoint('last_processed_chunk', idx - 1)
                job_state.chunks_processed = idx
                return all_findings, total_usage

            logger.info(
                f"Processing chunk {chunk_num}/{len(chunks)}",
                phase="chunk_processing"
            )

            try:
                chunk_start = time.time()

                # Process chunk
                findings, usage = process_chunk_fn(chunks[idx], job_state.report_id)

                chunk_duration_ms = int((time.time() - chunk_start) * 1000)

                # Log chunk metrics
                logger.log_chunk_processing(
                    chunk_num=chunk_num,
                    total_chunks=len(chunks),
                    findings_count=len(findings),
                    duration_ms=chunk_duration_ms,
                    tokens_used=usage
                )

                # Aggregate results
                all_findings.extend(findings)
                for key in total_usage:
                    total_usage[key] += usage.get(key, 0)

                # Update state
                job_state.chunks_processed = idx + 1
                job_state.findings_count += len(findings)
                job_state.set_checkpoint(f'chunk_{idx}_findings_count', len(findings))

                # Rate limiting (except last chunk in batch)
                if idx < batch_end_idx - 1:
                    logger.info(
                        f"Waiting {self.config.chunk_delay_seconds}s before next chunk",
                        phase="rate_limit"
                    )
                    time.sleep(self.config.chunk_delay_seconds)

            except Exception as e:
                logger.error(
                    f"Error processing chunk {chunk_num}: {str(e)}",
                    phase="chunk_processing",
                    exception=e,
                    chunk_num=chunk_num
                )

                # Add error to state
                job_state.add_error(
                    f"Chunk {chunk_num} failed: {str(e)}",
                    "chunk_processing"
                )

                # Continue with next chunk (don't fail entire batch)
                continue

        return all_findings, total_usage

    def resume_from_checkpoint(
        self,
        job_id: str,
        batch_num: int,
        logger: StructuredLogger
    ) -> Optional[JobState]:
        """
        Resume job from R2 checkpoint

        Implements checkpoint/resume pattern for fault tolerance
        """
        logger.info(
            f"Attempting to resume job {job_id} at batch {batch_num}",
            phase="resume"
        )

        # Load state from R2
        job_state = self.state_manager.load_state(job_id)

        if not job_state:
            logger.error(
                f"No checkpoint found for job {job_id}",
                phase="resume"
            )
            return None

        # Validate state
        if job_state.phase == JobPhase.COMPLETED:
            logger.info("Job already completed", phase="resume")
            return job_state

        if job_state.phase == JobPhase.FAILED:
            if not job_state.should_retry():
                logger.error(
                    f"Job failed and exceeded max retries ({job_state.max_retries})",
                    phase="resume"
                )
                return None

            logger.info(
                f"Retrying failed job (attempt {job_state.retry_count + 1}/{job_state.max_retries})",
                phase="resume"
            )

        # Update batch number
        job_state.current_batch = batch_num
        job_state.lambda_invocations += 1

        logger.info(
            f"Resumed job from checkpoint",
            phase="resume",
            chunks_processed=job_state.chunks_processed,
            findings_count=job_state.findings_count,
            current_batch=job_state.current_batch
        )

        return job_state

    def save_checkpoint(
        self,
        job_state: JobState,
        logger: StructuredLogger
    ) -> bool:
        """Save checkpoint to R2"""
        logger.info(
            "Saving checkpoint to R2",
            phase="checkpoint",
            chunks_processed=job_state.chunks_processed,
            findings_count=job_state.findings_count
        )

        success = self.state_manager.save_state(job_state)

        if success:
            logger.info("Checkpoint saved successfully", phase="checkpoint")
        else:
            logger.error("Failed to save checkpoint", phase="checkpoint")

        return success

    def is_batch_complete(
        self,
        job_state: JobState
    ) -> bool:
        """Check if all batches are complete"""
        return job_state.chunks_processed >= job_state.total_chunks

    def orchestrate_batches(
        self,
        job_state: JobState,
        chunks: List[bytes],
        process_chunk_fn: callable,
        logger: StructuredLogger
    ) -> bool:
        """
        Orchestrate multi-batch processing

        Returns True if all batches complete, False if yielding to next batch
        """
        start_time = time.time()
        job_state.total_chunks = len(chunks)

        # Calculate total batches needed
        job_state.total_batches = (len(chunks) + self.config.chunks_per_batch - 1) // self.config.chunks_per_batch

        logger.info(
            f"Starting batch orchestration",
            phase="orchestration",
            total_chunks=len(chunks),
            total_batches=job_state.total_batches,
            current_batch=job_state.current_batch + 1
        )

        # Process chunks for this batch
        findings, usage = self.process_chunk_batch(
            job_state, chunks, process_chunk_fn, logger, start_time
        )

        # Update state with results
        job_state.set_checkpoint('findings', findings)
        job_state.set_checkpoint('usage', usage)

        # Save checkpoint after batch
        self.save_checkpoint(job_state, logger)

        # Check if all batches complete
        if self.is_batch_complete(job_state):
            logger.info(
                "All batches completed",
                phase="orchestration",
                total_findings=job_state.findings_count
            )
            return True

        # More batches needed - trigger next batch
        logger.info(
            f"Batch {job_state.current_batch + 1} complete, triggering next batch",
            phase="orchestration",
            next_batch=job_state.current_batch + 2
        )

        self.trigger_next_batch(job_state, logger)
        return False
