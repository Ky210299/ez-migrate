#!/bin/sh
# User that can only connect with SSL, for the SSL tests
set -e
psql -v ON_ERROR_STOP=1 -U postgres -c "CREATE ROLE ezm_ssl LOGIN SUPERUSER PASSWORD 'ezmigrate'"
sed -i '1i hostnossl all ezm_ssl all reject' "$PGDATA/pg_hba.conf"
