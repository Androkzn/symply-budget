#!/bin/bash
set -e

echo "Creating Lambda Layer for PyMuPDF and Pillow..."

# Create layer directory structure
rm -rf layer
mkdir -p layer/python/lib/python3.11/site-packages

# Install only PyMuPDF and Pillow to the layer
pip install PyMuPDF>=1.23.0 Pillow>=10.0.0 -t layer/python/lib/python3.11/site-packages

# Create layer package
cd layer
zip -r ../image-processing-layer.zip .
cd ..

echo "Layer package created: image-processing-layer.zip ($(du -h image-processing-layer.zip | cut -f1))"
