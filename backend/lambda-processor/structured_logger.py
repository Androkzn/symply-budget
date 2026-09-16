"""
Structured Logging to R2 for AI Pipeline Analysis

Implements 2026 best practices for Lambda structured logging with S3 export.
Logs are batched and uploaded to R2 for cost-effective long-term analysis.
"""

import json
import time
from datetime import datetime
from typing import Dict, Any, List, Optional
from enum import Enum
import io


class LogLevel(str, Enum):
    """Log levels"""
    DEBUG = "DEBUG"
    INFO = "INFO"
    WARNING = "WARNING"
    ERROR = "ERROR"
    CRITICAL = "CRITICAL"


class StructuredLogger:
    """
    Structured JSON logger with R2 export

    Features:
    - Structured JSON logs for easy parsing
    - Automatic metadata (timestamp, job_id, phase)
    - Batching for efficient R2 uploads
    - Flush on Lambda termination
    """

    def __init__(self, job_id: str, report_id: str, s3_client=None, bucket: str = None):
        self.job_id = job_id
        self.report_id = report_id
        self.s3_client = s3_client
        self.bucket = bucket
        self.logs: List[Dict[str, Any]] = []
        self.log_batch_size = 100  # Flush every 100 logs or on demand
        self.started_at = datetime.utcnow()
        self.r2_write_enabled = True  # Will disable if write fails
        self.r2_write_failed_notified = False

        # Performance tracking
        self.metrics: Dict[str, Any] = {
            'lambda_invocations': 0,
            'chunks_processed': 0,
            'findings_extracted': 0,
            'api_calls': {},  # Track API calls by service
            'errors': [],
            'warnings': []
        }

    def _create_log_entry(
        self,
        level: LogLevel,
        message: str,
        phase: Optional[str] = None,
        **kwargs
    ) -> Dict[str, Any]:
        """Create structured log entry"""
        entry = {
            'timestamp': datetime.utcnow().isoformat(),
            'level': level.value,
            'job_id': self.job_id,
            'report_id': self.report_id,
            'message': message,
            'elapsed_ms': int((datetime.utcnow() - self.started_at).total_seconds() * 1000)
        }

        if phase:
            entry['phase'] = phase

        # Add custom fields
        entry.update(kwargs)

        return entry

    def debug(self, message: str, phase: Optional[str] = None, **kwargs):
        """Log debug message"""
        entry = self._create_log_entry(LogLevel.DEBUG, message, phase, **kwargs)
        self.logs.append(entry)
        print(json.dumps(entry))  # Also print to CloudWatch

        if len(self.logs) >= self.log_batch_size:
            self.flush()

    def info(self, message: str, phase: Optional[str] = None, **kwargs):
        """Log info message"""
        entry = self._create_log_entry(LogLevel.INFO, message, phase, **kwargs)
        self.logs.append(entry)
        print(json.dumps(entry))

        if len(self.logs) >= self.log_batch_size:
            self.flush()

    def warning(self, message: str, phase: Optional[str] = None, **kwargs):
        """Log warning message"""
        entry = self._create_log_entry(LogLevel.WARNING, message, phase, **kwargs)
        self.logs.append(entry)
        self.metrics['warnings'].append(entry)
        print(json.dumps(entry))

        if len(self.logs) >= self.log_batch_size:
            self.flush()

    def error(self, message: str, phase: Optional[str] = None, exception: Optional[Exception] = None, **kwargs):
        """Log error message"""
        if exception:
            kwargs['exception_type'] = type(exception).__name__
            kwargs['exception_message'] = str(exception)

        entry = self._create_log_entry(LogLevel.ERROR, message, phase, **kwargs)
        self.logs.append(entry)
        self.metrics['errors'].append(entry)
        print(json.dumps(entry))

        # Always flush on errors
        self.flush()

    def critical(self, message: str, phase: Optional[str] = None, exception: Optional[Exception] = None, **kwargs):
        """Log critical message"""
        if exception:
            kwargs['exception_type'] = type(exception).__name__
            kwargs['exception_message'] = str(exception)

        entry = self._create_log_entry(LogLevel.CRITICAL, message, phase, **kwargs)
        self.logs.append(entry)
        self.metrics['errors'].append(entry)
        print(json.dumps(entry))

        # Always flush on critical errors
        self.flush()

    def log_api_call(self, service: str, operation: str, duration_ms: int, success: bool = True, **kwargs):
        """Log API call with timing"""
        if service not in self.metrics['api_calls']:
            self.metrics['api_calls'][service] = {
                'total_calls': 0,
                'total_duration_ms': 0,
                'success_count': 0,
                'error_count': 0
            }

        self.metrics['api_calls'][service]['total_calls'] += 1
        self.metrics['api_calls'][service]['total_duration_ms'] += duration_ms

        if success:
            self.metrics['api_calls'][service]['success_count'] += 1
        else:
            self.metrics['api_calls'][service]['error_count'] += 1

        self.info(
            f"{service}.{operation}",
            phase="api_call",
            service=service,
            operation=operation,
            duration_ms=duration_ms,
            success=success,
            **kwargs
        )

    def log_chunk_processing(
        self,
        chunk_num: int,
        total_chunks: int,
        findings_count: int,
        duration_ms: int,
        tokens_used: Dict[str, int]
    ):
        """Log chunk processing metrics"""
        self.metrics['chunks_processed'] += 1
        self.metrics['findings_extracted'] += findings_count

        self.info(
            f"Chunk {chunk_num}/{total_chunks} processed",
            phase="chunk_processing",
            chunk_num=chunk_num,
            total_chunks=total_chunks,
            findings_count=findings_count,
            duration_ms=duration_ms,
            **tokens_used
        )

    def flush(self):
        """Flush logs to R2 (optional - falls back to CloudWatch only)"""
        if not self.logs or not self.s3_client or not self.bucket or not self.r2_write_enabled:
            return

        try:
            # Create log file with timestamp
            timestamp = datetime.utcnow().strftime('%Y%m%d-%H%M%S')
            log_key = f"logs/{self.report_id}/{self.job_id}/{timestamp}.jsonl"

            # Write logs as JSONL (one JSON object per line)
            log_buffer = io.StringIO()
            for entry in self.logs:
                log_buffer.write(json.dumps(entry) + '\n')

            # Upload to R2
            self.s3_client.put_object(
                Bucket=self.bucket,
                Key=log_key,
                Body=log_buffer.getvalue().encode('utf-8'),
                ContentType='application/x-ndjson'
            )

            print(f"[LOGGER] Flushed {len(self.logs)} logs to R2: {log_key}")
            self.logs = []  # Clear buffer after successful upload

        except Exception as e:
            # Disable R2 writes after first failure and only log once
            if not self.r2_write_failed_notified:
                print(f"[LOGGER] R2 write disabled (logs available in CloudWatch): {type(e).__name__}")
                self.r2_write_failed_notified = True
            self.r2_write_enabled = False
            self.logs = []  # Clear buffer to prevent memory buildup

    def save_final_metrics(self):
        """Save final execution metrics to R2"""
        if not self.s3_client or not self.bucket:
            return

        try:
            self.flush()  # Flush any remaining logs

            # Calculate final metrics
            self.metrics['total_duration_ms'] = int(
                (datetime.utcnow() - self.started_at).total_seconds() * 1000
            )

            # Save metrics summary
            metrics_key = f"logs/{self.report_id}/{self.job_id}/metrics.json"
            metrics_data = json.dumps(self.metrics, indent=2)

            self.s3_client.put_object(
                Bucket=self.bucket,
                Key=metrics_key,
                Body=metrics_data.encode('utf-8'),
                ContentType='application/json'
            )

            print(f"[LOGGER] Saved final metrics to {metrics_key}")

        except Exception as e:
            print(f"[LOGGER] Error saving metrics: {str(e)}")


class LogAnalyzer:
    """
    Analyze logs from R2 for prompt improvement

    Reads JSONL logs from R2 and provides insights:
    - Processing time per phase
    - Error patterns
    - Token usage statistics
    - API call performance
    """

    def __init__(self, s3_client, bucket: str):
        self.s3_client = s3_client
        self.bucket = bucket

    def load_job_logs(self, report_id: str, job_id: str) -> List[Dict[str, Any]]:
        """Load all logs for a job from R2"""
        logs = []
        prefix = f"logs/{report_id}/{job_id}/"

        try:
            # List all log files
            response = self.s3_client.list_objects_v2(
                Bucket=self.bucket,
                Prefix=prefix
            )

            for obj in response.get('Contents', []):
                if obj['Key'].endswith('.jsonl'):
                    # Download and parse JSONL
                    log_obj = self.s3_client.get_object(
                        Bucket=self.bucket,
                        Key=obj['Key']
                    )
                    log_content = log_obj['Body'].read().decode('utf-8')

                    for line in log_content.strip().split('\n'):
                        if line:
                            logs.append(json.loads(line))

        except Exception as e:
            print(f"[ANALYZER] Error loading logs: {str(e)}")

        return logs

    def analyze_phase_performance(self, logs: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Analyze performance by processing phase"""
        phase_stats = {}

        for log in logs:
            phase = log.get('phase')
            if not phase:
                continue

            if phase not in phase_stats:
                phase_stats[phase] = {
                    'count': 0,
                    'total_duration_ms': 0,
                    'errors': 0
                }

            phase_stats[phase]['count'] += 1

            if log.get('level') == 'ERROR':
                phase_stats[phase]['errors'] += 1

            if 'duration_ms' in log:
                phase_stats[phase]['total_duration_ms'] += log['duration_ms']

        # Calculate averages
        for phase, stats in phase_stats.items():
            if stats['count'] > 0 and stats['total_duration_ms'] > 0:
                stats['avg_duration_ms'] = stats['total_duration_ms'] / stats['count']

        return phase_stats

    def get_error_patterns(self, logs: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Extract error patterns for debugging"""
        errors = [log for log in logs if log.get('level') in ['ERROR', 'CRITICAL']]

        # Group by error type
        error_groups = {}
        for error in errors:
            error_type = error.get('exception_type', 'unknown')
            if error_type not in error_groups:
                error_groups[error_type] = []
            error_groups[error_type].append(error)

        return [
            {
                'error_type': error_type,
                'count': len(group),
                'examples': group[:5]  # First 5 examples
            }
            for error_type, group in error_groups.items()
        ]

    def get_token_usage(self, logs: List[Dict[str, Any]]) -> Dict[str, int]:
        """Calculate total token usage"""
        total_tokens = {
            'input_tokens': 0,
            'output_tokens': 0,
            'cache_creation_tokens': 0,
            'cache_read_tokens': 0
        }

        for log in logs:
            for key in total_tokens.keys():
                if key in log:
                    total_tokens[key] += log[key]

        return total_tokens
