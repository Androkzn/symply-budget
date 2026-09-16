#!/bin/bash
echo "Starting error monitoring at $(date)"
while true; do
  # Check TypeScript errors
  echo -e "\n=== TypeScript Check at $(date +%H:%M:%S) ==="
  tsc_output=$(npx tsc --noEmit 2>&1)
  if [ -n "$tsc_output" ]; then
    echo "⚠️  TypeScript Errors Found:"
    echo "$tsc_output" | head -30
  else
    echo "✅ No TypeScript errors"
  fi
  
  # Wait 30 seconds before next check
  sleep 30
done
