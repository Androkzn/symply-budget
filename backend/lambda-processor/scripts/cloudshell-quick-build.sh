#!/bin/bash
set -e
cd ~/lambda-processor
rm -rf package lambda-function.zip
mkdir -p package
pip3 install --target package/ -r requirements.txt
cp handler.py package/
cd package && zip -r ../lambda-function.zip . && cd ..
ls -lh lambda-function.zip
echo "✅ Build complete! Download lambda-function.zip"
