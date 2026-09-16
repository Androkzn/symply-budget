# Floor plan vectorizer container (VTracer + PDF rasterize)
#
# Build:
#   docker build -t floor-plan-vectorizer ./backend/vectorizer-container
#
# Run locally:
#   docker run -p 8080:8080 -e VECTORIZER_TRACE_TOKEN=devtoken floor-plan-vectorizer
#
# Wire into Worker secrets / vars:
#   VECTORIZER_TRACE_URL=https://your-container.example.com
#   VECTORIZER_TRACE_TOKEN=...
#
# Endpoints:
#   GET  /health
#   POST /trace      { imageBase64|imageUrl, contentType } → { svg }
#   POST /rasterize  { imageBase64|imageUrl, contentType } → { pngBase64, width, height }
