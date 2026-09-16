"""
Job State Management for Long-Running PDF Processing

Implements checkpoint/resume pattern with R2 storage for reliable batch processing.
Based on 2026 AWS best practices for serverless state management.
"""

import json
import time
from datetime import datetime
from typing import Dict, Any, List, Optional
from enum import Enum


class JobPhase(str, Enum):
    """Processing phases for checkpoint tracking"""
    INITIALIZING = "initializing"
    DOWNLOADING = "downloading"
    SPLITTING = "splitting"
    EXTRACTING_FINDINGS = "extracting_findings"
    STORING_FINDINGS = "storing_findings"
    EXTRACTING_IMAGES = "extracting_images"
    ANALYZING_IMAGES = "analyzing_images"
    GENERATING_SUMMARIES = "generating_summaries"
    GENERATING_ACTION_PLANS = "generating_action_plans"
    GENERATING_TASK_DRAFTS = "generating_task_drafts"
    EXTRACTING_HOME_FEATURES = "extracting_home_features"
    SENDING_NOTIFICATIONS = "sending_notifications"
    COMPLETED = "completed"
    FAILED = "failed"


class JobState:
    """
    Job state with checkpoint/resume capability

    Stores state in R2 using "claim check" pattern - lightweight metadata
    with pointers to large data objects.
    """

    def __init__(self, job_id: str, report_id: str, household_id: str):
        self.job_id = job_id
        self.report_id = report_id
        self.household_id = household_id
        self.phase = JobPhase.INITIALIZING
        self.progress = 0
        self.started_at = datetime.utcnow().isoformat()
        self.updated_at = datetime.utcnow().isoformat()
        self.completed_at: Optional[str] = None

        # Checkpoint data
        self.checkpoints: Dict[str, Any] = {}
        self.current_batch = 0
        self.total_batches = 0

        # Results tracking
        self.findings_count = 0
        self.images_count = 0
        self.chunks_processed = 0
        self.total_chunks = 0

        # Error tracking
        self.errors: List[Dict] = []
        self.retry_count = 0
        self.max_retries = 3

        # Resource pointers (claim check pattern)
        self.pdf_s3_key: Optional[str] = None
        self.chunks_s3_keys: List[str] = []
        self.findings_s3_key: Optional[str] = None
        self.logs_s3_key: Optional[str] = None

        # Execution metadata
        self.execution_history: List[Dict] = []
        self.lambda_invocations = 0
        self.total_duration_ms = 0

    def to_dict(self) -> Dict[str, Any]:
        """Serialize state to dict for R2 storage"""
        return {
            'job_id': self.job_id,
            'report_id': self.report_id,
            'household_id': self.household_id,
            'phase': self.phase.value,
            'progress': self.progress,
            'started_at': self.started_at,
            'updated_at': self.updated_at,
            'completed_at': self.completed_at,
            'checkpoints': self.checkpoints,
            'current_batch': self.current_batch,
            'total_batches': self.total_batches,
            'findings_count': self.findings_count,
            'images_count': self.images_count,
            'chunks_processed': self.chunks_processed,
            'total_chunks': self.total_chunks,
            'errors': self.errors,
            'retry_count': self.retry_count,
            'max_retries': self.max_retries,
            'pdf_s3_key': self.pdf_s3_key,
            'chunks_s3_keys': self.chunks_s3_keys,
            'findings_s3_key': self.findings_s3_key,
            'logs_s3_key': self.logs_s3_key,
            'execution_history': self.execution_history,
            'lambda_invocations': self.lambda_invocations,
            'total_duration_ms': self.total_duration_ms,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'JobState':
        """Deserialize state from R2"""
        state = cls(
            data['job_id'],
            data['report_id'],
            data['household_id']
        )
        state.phase = JobPhase(data['phase'])
        state.progress = data['progress']
        state.started_at = data['started_at']
        state.updated_at = data['updated_at']
        state.completed_at = data.get('completed_at')
        state.checkpoints = data.get('checkpoints', {})
        state.current_batch = data.get('current_batch', 0)
        state.total_batches = data.get('total_batches', 0)
        state.findings_count = data.get('findings_count', 0)
        state.images_count = data.get('images_count', 0)
        state.chunks_processed = data.get('chunks_processed', 0)
        state.total_chunks = data.get('total_chunks', 0)
        state.errors = data.get('errors', [])
        state.retry_count = data.get('retry_count', 0)
        state.max_retries = data.get('max_retries', 3)
        state.pdf_s3_key = data.get('pdf_s3_key')
        state.chunks_s3_keys = data.get('chunks_s3_keys', [])
        state.findings_s3_key = data.get('findings_s3_key')
        state.logs_s3_key = data.get('logs_s3_key')
        state.execution_history = data.get('execution_history', [])
        state.lambda_invocations = data.get('lambda_invocations', 0)
        state.total_duration_ms = data.get('total_duration_ms', 0)
        return state

    def update_phase(self, phase: JobPhase, progress: int, message: str = ""):
        """Update processing phase with checkpoint"""
        self.phase = phase
        self.progress = progress
        self.updated_at = datetime.utcnow().isoformat()
        self.execution_history.append({
            'timestamp': self.updated_at,
            'phase': phase.value,
            'progress': progress,
            'message': message,
            'lambda_invocation': self.lambda_invocations
        })

    def add_error(self, error_message: str, phase: str, is_retryable: bool = True):
        """Track errors with retry logic"""
        self.errors.append({
            'timestamp': datetime.utcnow().isoformat(),
            'phase': phase,
            'message': error_message,
            'is_retryable': is_retryable,
            'retry_count': self.retry_count
        })

        if is_retryable:
            self.retry_count += 1

    def should_retry(self) -> bool:
        """Check if job should be retried"""
        return self.retry_count < self.max_retries

    def set_checkpoint(self, checkpoint_name: str, data: Any):
        """Save checkpoint data"""
        self.checkpoints[checkpoint_name] = {
            'data': data,
            'timestamp': datetime.utcnow().isoformat()
        }

    def get_checkpoint(self, checkpoint_name: str) -> Optional[Any]:
        """Retrieve checkpoint data"""
        checkpoint = self.checkpoints.get(checkpoint_name)
        return checkpoint['data'] if checkpoint else None

    def mark_completed(self):
        """Mark job as completed"""
        self.phase = JobPhase.COMPLETED
        self.progress = 100
        self.completed_at = datetime.utcnow().isoformat()
        self.updated_at = self.completed_at

    def mark_failed(self, error_message: str):
        """Mark job as failed"""
        self.phase = JobPhase.FAILED
        self.add_error(error_message, self.phase.value, is_retryable=False)
        self.completed_at = datetime.utcnow().isoformat()
        self.updated_at = self.completed_at


class JobStateManager:
    """
    Manages job state persistence in R2

    Implements claim check pattern: lightweight state in R2 with pointers
    to large data objects (chunks, findings, logs).
    """

    def __init__(self, s3_client, bucket: str):
        self.s3_client = s3_client
        self.bucket = bucket

    def get_state_key(self, job_id: str) -> str:
        """Get R2 key for job state"""
        return f"job-states/{job_id}/state.json"

    def save_state(self, state: JobState) -> bool:
        """Save job state to R2"""
        try:
            key = self.get_state_key(state.job_id)
            data = json.dumps(state.to_dict(), indent=2)

            self.s3_client.put_object(
                Bucket=self.bucket,
                Key=key,
                Body=data.encode('utf-8'),
                ContentType='application/json'
            )

            print(f"[STATE] Saved job state to {key}")
            return True

        except Exception as e:
            print(f"[STATE] Error saving state: {str(e)}")
            return False

    def load_state(self, job_id: str) -> Optional[JobState]:
        """Load job state from R2"""
        try:
            key = self.get_state_key(job_id)

            response = self.s3_client.get_object(
                Bucket=self.bucket,
                Key=key
            )

            data = json.loads(response['Body'].read().decode('utf-8'))
            state = JobState.from_dict(data)

            print(f"[STATE] Loaded job state from {key}")
            return state

        except self.s3_client.exceptions.NoSuchKey:
            print(f"[STATE] No existing state found for job {job_id}")
            return None
        except Exception as e:
            print(f"[STATE] Error loading state: {str(e)}")
            return None

    def delete_state(self, job_id: str) -> bool:
        """Delete job state from R2"""
        try:
            key = self.get_state_key(job_id)
            self.s3_client.delete_object(Bucket=self.bucket, Key=key)
            print(f"[STATE] Deleted job state {key}")
            return True
        except Exception as e:
            print(f"[STATE] Error deleting state: {str(e)}")
            return False
