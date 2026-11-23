#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
build_dir="${TINYTUNE_BUILD_DIR:-$PWD/.build-output}"
workspace=tinytune.xcworkspace

swift test --package-path packages/TinytuneKit
xcodebuild -workspace "$workspace" -scheme Tinytune-macOS \
  -destination "platform=macOS,arch=$(uname -m)" -derivedDataPath "$build_dir/macOS" build
xcodebuild -workspace "$workspace" -scheme Tinytune-iOS \
  -destination 'generic/platform=iOS' -derivedDataPath "$build_dir/iPhoneOS" CODE_SIGNING_ALLOWED=NO build
xcodebuild -workspace "$workspace" -scheme Tinytune-iOS \
  -destination 'generic/platform=iOS Simulator' -derivedDataPath "$build_dir/iOSSimulator" CODE_SIGNING_ALLOWED=NO build
