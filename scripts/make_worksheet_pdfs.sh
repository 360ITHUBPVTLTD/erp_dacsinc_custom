#!/usr/bin/env bash
# Regenerates the two printable worksheets offered by /roles-and-permissions
# ("Download PDF" buttons) from the live page, with headless Chrome — run it
# after changing the role or document lists in www/roles-and-permissions.html,
# then bump the ?v= number on the Download links there so browsers fetch the new file.
#   usage (from the bench root):  apps/erp_dacsinc_custom/scripts/make_worksheet_pdfs.sh [site-host] [port]
set -euo pipefail
HOST="${1:-dacsinc.local}"; PORT="${2:-8000}"
APP="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$APP/erp_dacsinc_custom/public/docs"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser)"
mkdir -p "$OUT"
curl -sf -H "Host: $HOST" "http://127.0.0.1:$PORT/roles-and-permissions" -o "$TMP/page.html"
for mode in ws dt; do
  python3 - "$TMP/page.html" "$TMP/$mode.html" "$mode" <<'PY'
import sys
src, dst, mode = sys.argv[1:]
s = open(src).read()
s = s.replace("<body>", f'<body class="{mode}-printing">', 1)
s = s.replace("</head>", "<style>@page { size: A4 landscape; margin: 10mm; }</style></head>", 1)
open(dst, "w").write(s)
PY
  "$CHROME" --headless=new --disable-gpu --no-sandbox --no-pdf-header-footer \
    --print-to-pdf="$TMP/$mode.pdf" "file://$TMP/$mode.html" 2>/dev/null
done
cp "$TMP/ws.pdf" "$OUT/tab-access-worksheet.pdf"
cp "$TMP/dt.pdf" "$OUT/document-access-worksheet.pdf"
echo "Written: $OUT/tab-access-worksheet.pdf, $OUT/document-access-worksheet.pdf"
