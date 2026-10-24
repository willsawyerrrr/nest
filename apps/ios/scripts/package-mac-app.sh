#!/bin/bash
# Builds the native macOS app, signed with a Developer ID Application identity,
# and zips it to `Nest.zip` at the repository root.
#
# Usage: apps/ios/scripts/package-mac-app.sh [version]
#
# Requires `SUPABASE_URL` and `SUPABASE_ANON_KEY` (substituted into `Info.plist`
# by `xcodegen generate`) and `SIGNING_IDENTITY`, the full name of a Developer ID
# Application identity in the default keychain. When `NOTARY_KEY_PATH`,
# `NOTARY_KEY_ID`, and `NOTARY_ISSUER_ID` are set, also notarises the zip and
# staples the ticket to the app before re-zipping; without them the build is
# signed but not notarised, which Gatekeeper rejects on another Mac.
set -euo pipefail

root="$(cd "$(dirname "$0")/../../.." && pwd)"
ios="$root/apps/ios"
version="${1:-0.0.0}"
derived="$ios/build/mac"
app="$derived/Build/Products/Release/Nest.app"
zip="$root/Nest.zip"

: "${SUPABASE_URL:?}" "${SUPABASE_ANON_KEY:?}" "${SIGNING_IDENTITY:?}"

cd "$ios"
command -v xcodegen >/dev/null || brew install xcodegen
xcodegen generate

# Developer ID signs with no provisioning profile, so the entitlements must stay
# within what macOS grants without one (see `docs/ios.md`).
xcodebuild \
    -project Nest.xcodeproj \
    -scheme NestMac \
    -configuration Release \
    -destination 'platform=macOS' \
    -derivedDataPath "$derived" \
    -skipPackagePluginValidation \
    -skipMacroValidation \
    CODE_SIGN_STYLE=Manual \
    CODE_SIGN_IDENTITY="$SIGNING_IDENTITY" \
    DEVELOPMENT_TEAM=8558CXPT9G \
    PROVISIONING_PROFILE_SPECIFIER= \
    CODE_SIGN_INJECT_BASE_ENTITLEMENTS=NO \
    OTHER_CODE_SIGN_FLAGS=--timestamp \
    MARKETING_VERSION="$version" \
    CURRENT_PROJECT_VERSION="${GITHUB_RUN_NUMBER:-1}" \
    build

codesign --verify --deep --strict "$app"

rm "$zip" 2>/dev/null || true
ditto -c -k --keepParent "$app" "$zip"

if [[ -n "${NOTARY_KEY_PATH:-}" ]]; then
    result="$(xcrun notarytool submit "$zip" \
        --key "$NOTARY_KEY_PATH" --key-id "$NOTARY_KEY_ID" --issuer "$NOTARY_ISSUER_ID" \
        --wait --output-format json)"
    echo "$result"
    status="$(plutil -extract status raw -o - - <<<"$result")"
    if [[ "$status" != "Accepted" ]]; then
        id="$(plutil -extract id raw -o - - <<<"$result")"
        xcrun notarytool log "$id" \
            --key "$NOTARY_KEY_PATH" --key-id "$NOTARY_KEY_ID" --issuer "$NOTARY_ISSUER_ID" >&2
        echo "Notarisation failed: $status" >&2
        exit 1
    fi
    xcrun stapler staple "$app"
    rm "$zip"
    ditto -c -k --keepParent "$app" "$zip"
fi
echo "Packaged $zip"
