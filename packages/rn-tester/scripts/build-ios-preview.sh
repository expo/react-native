#!/bin/bash
# Local RNTester iPhone preview build: archive -> ad-hoc export -> eas upload.
# Bypasses EAS cloud build (RNTester is bare RN, builds RN from source).
#
# Lives in the repo, not /tmp: /tmp gets cleared, and rewriting this from
# memory each time is how the same two bugs kept coming back — uploading from
# the wrong directory, and forgetting that touching Podfile.lock desyncs the
# CocoaPods sandbox and fails the NEXT build.
set -euo pipefail

REPO=/Users/ideagent/Developer/react-native
RNT=$REPO/packages/rn-tester
KEYID=YH6LT22U5P
ISSUER=69a6de7e-ee52-47e3-e053-5b8c7c11a4d1
TEAM=C8D8QTF339
OUT=/tmp/rntester-preview
mkdir -p "$OUT"

cd "$RNT"

# Hermes bytecode version must match the SOURCE-built runtime the app links.
# yarn's postinstall can drop a PREBUILT hermes-compiler in node_modules, which
# react-native-xcode.sh would then use, producing a bundle the runtime refuses
# ("Wrong bytecode version. Expected 98 but got 99") at launch.
PODHERMESC="$RNT/Pods/hermes-engine/destroot/bin/hermesc"
NODEHERMESC="$REPO/node_modules/hermes-compiler/hermesc/osx-bin/hermesc"
if [ -f "$PODHERMESC" ] && [ -f "$NODEHERMESC" ]; then
  cp "$PODHERMESC" "$NODEHERMESC"
  echo "[preview] hermesc synced from pod destroot"
else
  echo "[preview] WARNING: hermesc not synced (pod=$PODHERMESC node=$NODEHERMESC)"
fi

# Resync the sandbox first: anything that touched Podfile.lock since the last
# build (including `git checkout --` on it) leaves the archive failing with
# "sandbox is not in sync".
echo "[preview] resyncing pods..."
LANG=en_US.UTF-8 pod update hermes-engine --no-repo-update >/dev/null

echo "[preview] archiving..."
xcodebuild archive \
  -workspace RNTesterPods.xcworkspace \
  -scheme RNTester \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$OUT/RNTester.xcarchive" \
  -allowProvisioningUpdates \
  -authenticationKeyPath ~/.asc/AuthKey_$KEYID.p8 \
  -authenticationKeyID $KEYID \
  -authenticationKeyIssuerID $ISSUER \
  DEVELOPMENT_TEAM=$TEAM \
  CODE_SIGN_STYLE=Automatic

cat > "$OUT/exportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>release-testing</string>
  <key>teamID</key><string>$TEAM</string>
  <key>signingStyle</key><string>automatic</string>
  <key>compileBitcode</key><false/>
</dict>
</plist>
PLIST

echo "[preview] exporting ad-hoc ipa..."
xcodebuild -exportArchive \
  -archivePath "$OUT/RNTester.xcarchive" \
  -exportOptionsPlist "$OUT/exportOptions.plist" \
  -exportPath "$OUT/export" \
  -allowProvisioningUpdates \
  -authenticationKeyPath ~/.asc/AuthKey_$KEYID.p8 \
  -authenticationKeyID $KEYID \
  -authenticationKeyIssuerID $ISSUER

IPA="$OUT/export/RNTester.ipa"
echo "[preview] verifying bundle bytecode header (expect c61f bc03 c103 191f):"
unzip -p "$IPA" Payload/RNTester.app/main.jsbundle | head -c12 | xxd || true

echo "[preview] uploading to EAS..."
cd "$RNT"   # `eas upload` must run from here: app.json lives in rn-tester,
            # and from the repo root it fails AND writes a stray app.json.
DISABLE_TUFT=1 npx --yes eas-cli@latest upload --platform ios --build-path "$IPA" --non-interactive 2>&1 | tail -20
echo "[preview] DONE"
