CREATE TABLE telemetry.schema_version (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    singleton boolean NOT NULL UNIQUE DEFAULT true CHECK (singleton),
    version integer NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE telemetry.telemetry_events (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    event_id text NOT NULL UNIQUE,
    controller_id text NOT NULL,
    event_type text NOT NULL,
    timestamp timestamptz NOT NULL,
    payload text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX telemetry_events_timestamp_id_idx
    ON telemetry.telemetry_events (timestamp DESC, id DESC);

CREATE TABLE telemetry.controller_latest (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    controller_id text NOT NULL UNIQUE,
    payload text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE telemetry.controller_observed (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    controller_id text NOT NULL UNIQUE
        REFERENCES telemetry.controller_latest (controller_id) ON DELETE CASCADE,
    observed_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE telemetry.controller_design_revision (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    singleton boolean NOT NULL UNIQUE DEFAULT true CHECK (singleton),
    revision bigint NOT NULL CHECK (revision >= 0),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE telemetry.controller_authoritative (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    controller_id text NOT NULL UNIQUE
        REFERENCES telemetry.controller_latest (controller_id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE telemetry.controller_tombstones (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    controller_id text NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE FUNCTION telemetry.set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = clock_timestamp();
    RETURN NEW;
END
$$;

CREATE TRIGGER schema_version_updated_at BEFORE UPDATE ON telemetry.schema_version
    FOR EACH ROW EXECUTE FUNCTION telemetry.set_updated_at();
CREATE TRIGGER telemetry_events_updated_at BEFORE UPDATE ON telemetry.telemetry_events
    FOR EACH ROW EXECUTE FUNCTION telemetry.set_updated_at();
CREATE TRIGGER controller_latest_updated_at BEFORE UPDATE ON telemetry.controller_latest
    FOR EACH ROW EXECUTE FUNCTION telemetry.set_updated_at();
CREATE TRIGGER controller_observed_updated_at BEFORE UPDATE ON telemetry.controller_observed
    FOR EACH ROW EXECUTE FUNCTION telemetry.set_updated_at();
CREATE TRIGGER controller_design_revision_updated_at BEFORE UPDATE ON telemetry.controller_design_revision
    FOR EACH ROW EXECUTE FUNCTION telemetry.set_updated_at();
CREATE TRIGGER controller_authoritative_updated_at BEFORE UPDATE ON telemetry.controller_authoritative
    FOR EACH ROW EXECUTE FUNCTION telemetry.set_updated_at();
CREATE TRIGGER controller_tombstones_updated_at BEFORE UPDATE ON telemetry.controller_tombstones
    FOR EACH ROW EXECUTE FUNCTION telemetry.set_updated_at();

INSERT INTO telemetry.schema_version (version) VALUES (1);
