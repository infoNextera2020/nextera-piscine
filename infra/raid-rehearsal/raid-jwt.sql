-- Fresh disposable instance bootstrap only. This file has NOT been executed.
-- Upstream jwt.sql names postgres literally; retain its setting for the chosen fixture DB.
\getenv fixture_database POSTGRES_DB
\getenv fixture_jwt_expiry JWT_EXP
ALTER DATABASE :"fixture_database" SET "app.settings.jwt_exp" TO :'fixture_jwt_expiry';
