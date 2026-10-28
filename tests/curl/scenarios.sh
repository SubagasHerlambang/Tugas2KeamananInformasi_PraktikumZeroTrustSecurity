#!/usr/bin/env bash
# Skenario curl positif & negatif terhadap stack yang SUDAH berjalan (npm start). Membutuhkan: bash, curl, node.
# Mengubah data demo (edit + finalisasi CLS-501) -> jalankan `npm run db:reset` dan restart service untuk mengulang.
#   B=http://127.0.0.1:3000 PW='SecureCampus-Demo-2026' SVC_SECRET=service-nilai-demo-secret-local ./tests/curl/scenarios.sh
# Skenario jam akses bergantung waktu server: set IN_WINDOW=false bila ACCESS_WINDOW_* tidak memuat jam sekarang.
B=${B:-http://127.0.0.1:3000}
PW=${PW:-SecureCampus-Demo-2026}
SVC_SECRET=${SVC_SECRET:-service-nilai-demo-secret-local}
IN_WINDOW=${IN_WINDOW:-true}
PASS=0; FAIL=0; BODY=$(mktemp)
trap 'rm -f "$BODY"' EXIT

jget() { node -pe "const j=JSON.parse(require('fs').readFileSync(0,'utf8')); $1" 2>/dev/null; }
req() { # method path [token] [device] [json-body]  -> mengisi $CODE dan $BODY
  local m=$1 p=$2 t=$3 d=$4 b=$5
  local args=(-s -o "$BODY" -w '%{http_code}' -X "$m" "$B$p")   # dipisah dari 'local' di atas agar $m/$p sudah terisi
  [ -n "$t" ] && args+=(-H "Authorization: Bearer $t")
  [ -n "$d" ] && args+=(-H "X-Device-ID: $d")
  [ -n "$b" ] && args+=(-H 'Content-Type: application/json' -d "$b")
  CODE=$(curl "${args[@]}")
}
expect() { # nama status [error.code]
  local ok=1
  [ "$CODE" = "$2" ] || ok=0
  if [ -n "$3" ]; then [ "$(jget 'j.error.code' < "$BODY")" = "$3" ] || ok=0; fi
  if [ $ok = 1 ]; then PASS=$((PASS+1)); echo "PASS  $1 -> $CODE ${3:+($3)}"; else FAIL=$((FAIL+1)); echo "FAIL  $1 -> diharapkan $2 ${3:+($3)}, aktual $CODE: $(head -c 200 "$BODY")"; fi
}
login() { req POST /auth/login "" "$2" "{\"username\":\"$1\",\"password\":\"$PW\"}"; jget 'j.access_token' < "$BODY"; }

echo "== Login & token =="
MT=$(login mhs.001 DEV-MHS-001); DT=$(login dosen.andi DEV-DOSEN-001); AT=$(login admin.demo DEV-ADMIN-001)
[ -n "$MT" ] && [ -n "$DT" ] && [ -n "$AT" ] && { PASS=$((PASS+1)); echo "PASS  login 3 role"; } || { FAIL=$((FAIL+1)); echo "FAIL  login 3 role (cek PW / service berjalan?)"; exit 1; }
req POST /auth/login "" DEV-MHS-001 '{"username":"mhs.001","password":"salah"}'; expect "TC-AUTH-02 password salah" 401 INVALID_CREDENTIALS
req POST /auth/login "" DEV-UNKNOWN "{\"username\":\"mhs.001\",\"password\":\"$PW\"}"; expect "TC-AUTH-03 device tak dikenal" 403 DEVICE_NOT_REGISTERED
req POST /auth/login "" DEV-MHS-002 "{\"username\":\"mhs.001\",\"password\":\"$PW\"}"; expect "TC-AUTH-04 device user lain" 403 DEVICE_NOT_REGISTERED
req GET /nilai "" DEV-MHS-001; expect "TC-AUTH-05 tanpa token" 401 AUTH_REQUIRED
req GET /nilai bukan.jwt.valid DEV-MHS-001; expect "TC-AUTH-05 token rusak" 401 INVALID_TOKEN
req GET /nilai "$MT" DEV-MHS-002; expect "AC-07 device user lain" 403 DEVICE_NOT_REGISTERED
req GET /nilai "$MT" ""; expect "AC-07 tanpa device" 403 DEVICE_NOT_REGISTERED

echo "== Kepemilikan data =="
req GET /nilai "$MT" DEV-MHS-001; expect "TC-VAL-01 mahasiswa baca nilai" 200
[ "$(jget 'j.data.every(g=>g.student_nim==="247006110001")' < "$BODY")" = true ] && echo "      (hanya NIM sendiri)" || { FAIL=$((FAIL+1)); echo "FAIL  data mahasiswa lain bocor"; }
req GET /transkrip/247006110002 "$MT" DEV-MHS-001; expect "TC-TR-02 IDOR transkrip NIM lain" 403 FORBIDDEN
req GET /transkrip/247006110001 "$MT" DEV-MHS-001; expect "TC-TR-01 transkrip sendiri" 200
req GET /transkrip/247006110003 "$AT" DEV-ADMIN-001; expect "TC-TR-03 admin baca NIM mana pun" 200
req PUT /nilai/GRD-501-001 "$AT" DEV-ADMIN-001 '{"score":100}'; expect "admin edit nilai ditolak" 403 FORBIDDEN
req PUT /nilai/GRD-502-001 "$DT" DEV-DOSEN-001 '{"score":50}'; expect "TC-VAL-04 dosen kelas lain" 403 CLASS_NOT_OWNED
req PUT /nilai/GRD-501-001 "$DT" DEV-DOSEN-001 '{"score":"85"}'; expect "TC-IN-01 skor string" 400 VALIDATION_ERROR
req PUT "/nilai/GRD-501-001'%20OR%201=1--" "$DT" DEV-DOSEN-001 '{"score":50}'; [ "$CODE" = 400 ] || [ "$CODE" = 404 ] && { PASS=$((PASS+1)); echo "PASS  TC-IN-02 SQL injection pada ID -> $CODE"; } || { FAIL=$((FAIL+1)); echo "FAIL  SQL injection -> $CODE"; }

echo "== Jam akses, nilai final, finalisasi =="
if [ "$IN_WINDOW" = true ]; then
  req PUT /nilai/GRD-501-001 "$DT" DEV-DOSEN-001 '{"score":85}'; expect "TC-VAL-05 edit nilai valid" 200
  req PUT /nilai/GRD-501-003 "$DT" DEV-DOSEN-001 '{"score":10}'; expect "TC-VAL-06 edit nilai final" 409 GRADE_FINAL
else
  req PUT /nilai/GRD-501-001 "$DT" DEV-DOSEN-001 '{"score":85}'; expect "TC-VAL-07 edit di luar jam" 403 OUT_OF_ACCESS_HOURS
fi
req POST /kelas/CLS-502/finalisasi "$DT" DEV-DOSEN-001; expect "TC-FIN-02 finalisasi kelas orang lain" 403 CLASS_NOT_OWNED
if [ "$IN_WINDOW" = true ]; then
  req POST /kelas/CLS-501/finalisasi "$DT" DEV-DOSEN-001; expect "TC-FIN-01 finalisasi kelas sendiri" 200
  req GET /transkrip/247006110001 "$MT" DEV-MHS-001; expect "transkrip terisi setelah finalisasi" 200
  [ "$(jget 'j.data.entries.length' < "$BODY")" -ge 1 ] && echo "      (entri published tampil)" || { FAIL=$((FAIL+1)); echo "FAIL  transkrip kosong setelah finalisasi"; }
  req POST /kelas/CLS-501/finalisasi "$DT" DEV-DOSEN-001; expect "TC-FIN-04 finalisasi ulang" 409 GRADE_FINAL
else
  req POST /kelas/CLS-501/finalisasi "$DT" DEV-DOSEN-001; expect "finalisasi di luar jam" 403 OUT_OF_ACCESS_HOURS
fi

echo "== Token service & sinkronisasi =="
req POST /auth/service "" "" "{\"client_id\":\"service-nilai\",\"client_secret\":\"$SVC_SECRET\"}"; expect "TC-SVC-01 token service" 200
SVC=$(jget 'j.access_token' < "$BODY"); echo "      (expires_in=$(jget 'j.expires_in' < "$BODY"))"
req POST /auth/service "" "" '{"client_id":"service-nilai","client_secret":"salah"}'; expect "TC-SVC-02 secret client salah" 401 INVALID_CREDENTIALS
req POST /transkrip/sinkron "$MT" DEV-MHS-001 '{}'; expect "TC-TR-04 token mahasiswa ke sinkron" 403 SERVICE_TOKEN_REQUIRED
req POST /transkrip/sinkron "$DT" "" '{}'; expect "TC-TR-04 token dosen ke sinkron" 403 SERVICE_TOKEN_REQUIRED
req POST /transkrip/sinkron "$AT" "" '{}'; expect "TC-TR-04 token admin ke sinkron" 403 SERVICE_TOKEN_REQUIRED
req GET /nilai "$SVC" DEV-DOSEN-001; expect "token service ke endpoint user" 403

echo "== Gateway: route & method =="
req GET /admin "$AT" DEV-ADMIN-001; expect "TC-GW-03 route tak dikenal" 404 RESOURCE_NOT_FOUND
req DELETE /nilai/GRD-501-001 "$DT" DEV-DOSEN-001; expect "method tak diizinkan" 405 METHOD_NOT_ALLOWED

echo "== Logout & refresh =="
req POST /auth/login "" DEV-MHS-002 "{\"username\":\"mhs.002\",\"password\":\"$PW\"}"; RT=$(jget 'j.refresh_token' < "$BODY")
req POST /auth/logout "" "" "{\"refresh_token\":\"$RT\"}"; expect "logout" 204
req POST /auth/refresh "" "" "{\"refresh_token\":\"$RT\"}"; expect "TC-AUTH-06 refresh setelah logout" 401

echo; echo "RINGKASAN CURL: $PASS PASS, $FAIL FAIL"; [ $FAIL = 0 ]
