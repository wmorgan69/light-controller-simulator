\getenv control_password CONTROL_DB_PASSWORD
\getenv telemetry_password TELEMETRY_DB_PASSWORD

CREATE ROLE control_app LOGIN PASSWORD :'control_password';
CREATE ROLE telemetry_app LOGIN PASSWORD :'telemetry_password';
REVOKE ALL ON DATABASE devices FROM PUBLIC;
GRANT CONNECT ON DATABASE devices TO control_app, telemetry_app;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
CREATE SCHEMA control AUTHORIZATION control_app;
CREATE SCHEMA telemetry AUTHORIZATION telemetry_app;
