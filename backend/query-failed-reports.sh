#!/bin/bash
echo "Querying failed reports from database..."
echo ""
echo "For PRODUCTION:"
wrangler d1 execute simple-house-db --remote --command "
  SELECT 
    id, 
    filename, 
    status, 
    error_message, 
    file_size,
    processing_stage,
    updated_at 
  FROM reports 
  WHERE status = 'failed' 
  ORDER BY updated_at DESC 
  LIMIT 5;
" 2>&1

echo ""
echo "For STAGING:"
wrangler d1 execute simple-house-db-staging --remote --command "
  SELECT 
    id, 
    filename, 
    status, 
    error_message, 
    file_size,
    processing_stage,
    updated_at 
  FROM reports 
  WHERE status = 'failed' 
  ORDER BY updated_at DESC 
  LIMIT 5;
" 2>&1
