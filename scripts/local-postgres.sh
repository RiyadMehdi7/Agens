#!/usr/bin/env bash
# Creates a local, disposable Postgres in Docker for testing the Agens Postgres connector.
# - Container agens-postgres on 127.0.0.1:55432 (loopback only) with synthetic analytics.revenue data.
# - A non-superuser, SELECT-only role agens_reader, as the connector requires.
# - A private connector config and access tokens in $AGENS_PRIVATE_DIR (default ~/.agens), mode 0600.
# Secrets are generated here and never printed. Safe to re-run: it reuses existing secrets and reloads the data.
set -euo pipefail
umask 077

DIR="${AGENS_PRIVATE_DIR:-$HOME/.agens}"
NAME="${AGENS_PG_CONTAINER:-agens-postgres}"
PORT="${AGENS_PG_PORT:-55432}"
mkdir -p "$DIR" && chmod 700 "$DIR"
rand() { openssl rand -hex 24; }
token() { openssl rand -base64 32 | tr '+/' '-_' | tr -d '='; }
sha() { if command -v sha256sum >/dev/null; then printf '%s' "$1" | sha256sum | cut -d' ' -f1; else printf '%s' "$1" | shasum -a 256 | cut -d' ' -f1; fi; }

[ -s "$DIR/postgres-admin.env" ] || printf 'POSTGRES_PASSWORD=%s\n' "$(rand)" > "$DIR/postgres-admin.env"
[ -s "$DIR/postgres-reader.pw" ] || rand > "$DIR/postgres-reader.pw"
if ! docker ps -a --format '{{.Names}}' | grep -qx "$NAME"; then
  docker run -d --name "$NAME" --restart unless-stopped --env-file "$DIR/postgres-admin.env" \
    -e POSTGRES_DB=agens -e TZ=UTC -p "127.0.0.1:$PORT:5432" postgres:16 >/dev/null
  echo "Started container $NAME on 127.0.0.1:$PORT"
else
  docker start "$NAME" >/dev/null
  echo "Container $NAME is running on 127.0.0.1:$PORT"
fi
# Wait for the final server: during first-time init a temporary socket-only server answers pg_isready too early.
for _ in $(seq 1 90); do docker exec "$NAME" psql -h 127.0.0.1 -U postgres -d agens -Atc 'SELECT 1' >/dev/null 2>&1 && break; sleep 1; done

docker exec -i "$NAME" psql -q -v ON_ERROR_STOP=1 -U postgres -d agens -v reader="$(cat "$DIR/postgres-reader.pw")" <<'SQL'
CREATE SCHEMA IF NOT EXISTS analytics;
DROP TABLE IF EXISTS analytics.revenue;
CREATE TABLE analytics.revenue (id integer PRIMARY KEY, month date NOT NULL, region text NOT NULL, channel text NOT NULL,
  revenue double precision NOT NULL, accounts integer NOT NULL);
-- Synthetic data: 9 months x 4 regions x 3 channels.
WITH m(i, t) AS (VALUES (0,412),(1,431),(2,447),(3,468),(4,489),(5,512),(6,538),(7,494),(8,521)),
     r(ri, name, sh) AS (VALUES (0,'North America',.39),(1,'Europe',.32),(2,'APAC',.195),(3,'LATAM',.095)),
     c(ci, name, cs) AS (VALUES (0,'Organic',.45),(1,'Referral',.30),(2,'Paid',.25))
INSERT INTO analytics.revenue
SELECT row_number() OVER (ORDER BY m.i, r.ri, c.ci), make_date(2026, m.i + 1, 1), r.name, c.name,
       round(m.t * r.sh * c.cs * 1000), round(m.t * r.sh * c.cs * 1.7)
FROM m, r, c;
DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'agens_reader') THEN CREATE ROLE agens_reader LOGIN; END IF; END $$;
ALTER ROLE agens_reader WITH LOGIN PASSWORD :'reader' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT CONNECT ON DATABASE agens TO agens_reader;
GRANT USAGE ON SCHEMA analytics TO agens_reader;
GRANT SELECT ON analytics.revenue TO agens_reader;
SQL

# Capabilities the user types into the canvas. The server config stores only their SHA-256 hashes.
if [ ! -s "$DIR/access-tokens.txt" ]; then
  printf 'revenue_db %s\nposts_api %s\n' "$(token)" "$(token)" > "$DIR/access-tokens.txt"
fi
DB_HASH=$(sha "$(awk '$1=="revenue_db"{print $2}' "$DIR/access-tokens.txt")")
API_HASH=$(sha "$(awk '$1=="posts_api"{print $2}' "$DIR/access-tokens.txt")")
cat > "$DIR/sources.json" <<JSON
{"sources":[
 {"id":"revenue_db","tokenHash":"$DB_HASH","kind":"postgres",
  "connection":{"connectionString":"postgres://agens_reader:$(cat "$DIR/postgres-reader.pw")@127.0.0.1:$PORT/agens"},
  "source":{"schema":"analytics","table":"revenue","orderBy":["id"],"columns":[
   {"name":"id","type":"number"},{"name":"month","type":"date"},{"name":"region","type":"string"},
   {"name":"channel","type":"string"},{"name":"revenue","type":"number"},{"name":"accounts","type":"number"}]}},
 {"id":"posts_api","tokenHash":"$API_HASH","kind":"https",
  "source":{"name":"Posts API (public, synthetic)","endpoint":"https://jsonplaceholder.typicode.com/posts",
   "allowedOrigins":["https://jsonplaceholder.typicode.com"]}}
]}
JSON
chmod 600 "$DIR"/*

ROWS=$(docker exec "$NAME" psql -At -U postgres -d agens -c "SELECT count(*) FROM analytics.revenue")
cat <<EOF
Loaded $ROWS synthetic rows into analytics.revenue.
Start Agens with:   AGENS_SOURCES_FILE=$DIR/sources.json npm run demo
In the canvas, Postgres tile -> Source ID: revenue_db, Access token: the revenue_db line of $DIR/access-tokens.txt
                API tile      -> Source ID: posts_api,  Access token: the posts_api line of the same file
Copy a token with:  awk '\$1=="revenue_db"{printf "%s", \$2}' $DIR/access-tokens.txt | pbcopy
EOF
