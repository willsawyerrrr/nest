#!/bin/bash
# Builds the native macOS app, signed with a Developer ID Application identity,
# and zips it to `Nest.zip` at the repository root.
#
# Usage: apps/ios/scripts/package-mac-app.sh [version]
#
# Requires `SUPABASE_URL` and `SUPABASE_ANON_KEY` (substituted into `Info.plist`
# by `xcodegen generate`), `SIGNING_IDENTITY`, the full name of a Developer ID
# Application identity in the default keychain, and `NOTARY_KEY_PATH`,
# `NOTARY_KEY_ID`, and `NOTARY_ISSUER_ID`: an App Store Connect API key, which
# fetches the Developer ID provisioning profiles the app and its share extension
# are signed with and notarises the zip before the ticket is stapled to the app.
set -euo pipefail

root="$(cd "$(dirname "$0")/../../.." && pwd)"
ios="$root/apps/ios"
version="${1:-0.0.0}"
derived="$ios/build/mac"
app="$derived/Build/Products/Release/Nest.app"
zip="$root/Nest.zip"

: "${SUPABASE_URL:?}" "${SUPABASE_ANON_KEY:?}" "${SIGNING_IDENTITY:?}"
: "${NOTARY_KEY_PATH:?}" "${NOTARY_KEY_ID:?}" "${NOTARY_ISSUER_ID:?}"

cd "$ios"
command -v xcodegen >/dev/null || brew install xcodegen
xcodegen generate

# The keychain access group and the App Group are restricted entitlements: each
# target is signed with the Developer ID profile named for its App ID (see
# `docs/ios.md`), which authorises team-prefixed groups.
app_profile="$(node "$ios/scripts/install-developer-id-profile.mjs" "Nest macOS Developer ID")"
extension_profile="$(node "$ios/scripts/install-developer-id-profile.mjs" "Nest macOS Share Extension Developer ID")"

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
    CODE_SIGN_INJECT_BASE_ENTITLEMENTS=NO \
    NEST_MAC_APP_PROFILE="$app_profile" \
    NEST_MAC_EXTENSION_PROFILE="$extension_profile" \
    OTHER_CODE_SIGN_FLAGS=--timestamp \
    MARKETING_VERSION="$version" \
    CURRENT_PROJECT_VERSION="${GITHUB_RUN_NUMBER:-1}" \
    build

codesign --verify --deep --strict "$app"

rm "$zip" 2>/dev/null || true
ditto -c -k --keepParent "$app" "$zip"

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
echo "Packaged $zip"
