-- Building Control owns this schema. Provision schema `control` and grant this role
-- ownership before applying migrations. The runtime seed is inserted once in the
-- same transaction as the initial migration.
DO $migration$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'control') THEN
        RAISE EXCEPTION 'The control schema must be provisioned before applying migrations';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'control'
          AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
    ) THEN
        RAISE EXCEPTION 'Cannot initialize a non-empty unversioned control schema';
    END IF;
END
$migration$;

CREATE TABLE control.schema_version (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    singleton_key smallint NOT NULL UNIQUE CHECK (singleton_key = 1),
    version integer NOT NULL CHECK (version > 0),
    seeded boolean NOT NULL DEFAULT false,
    applied_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE control.building (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    singleton_key smallint NOT NULL UNIQUE CHECK (singleton_key = 1),
    name text NOT NULL CHECK (length(trim(name)) > 0),
    saved_design_id uuid NOT NULL,
    active_design_id uuid NOT NULL,
    edit_revision bigint NOT NULL CHECK (edit_revision > 0),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE control.building_design (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    building_id uuid NOT NULL REFERENCES control.building(id),
    design jsonb NOT NULL,
    revision bigint NOT NULL CHECK (revision > 0),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (id, building_id),
    UNIQUE (building_id, revision)
);

ALTER TABLE control.building
    ADD CONSTRAINT building_saved_design_fk FOREIGN KEY (saved_design_id, id)
        REFERENCES control.building_design (id, building_id) DEFERRABLE INITIALLY DEFERRED,
    ADD CONSTRAINT building_active_design_fk FOREIGN KEY (active_design_id, id)
        REFERENCES control.building_design (id, building_id) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE control.retired_design_entity_id (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    building_id uuid NOT NULL REFERENCES control.building(id),
    external_id text NOT NULL UNIQUE,
    entity_type text NOT NULL,
    retired_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE control.controller_mqtt_retained_cleanup (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    building_id uuid NOT NULL REFERENCES control.building(id),
    controller_id text NOT NULL UNIQUE,
    active_design_revision bigint NOT NULL CHECK (active_design_revision > 0),
    status smallint NOT NULL CHECK (status BETWEEN 0 AND 3),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE FUNCTION control.set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = clock_timestamp();
    RETURN NEW;
END
$$;

CREATE TRIGGER schema_version_updated_at BEFORE UPDATE ON control.schema_version
    FOR EACH ROW EXECUTE FUNCTION control.set_updated_at();
CREATE TRIGGER building_updated_at BEFORE UPDATE ON control.building
    FOR EACH ROW EXECUTE FUNCTION control.set_updated_at();
CREATE TRIGGER building_design_updated_at BEFORE UPDATE ON control.building_design
    FOR EACH ROW EXECUTE FUNCTION control.set_updated_at();
CREATE TRIGGER retired_design_entity_id_updated_at BEFORE UPDATE ON control.retired_design_entity_id
    FOR EACH ROW EXECUTE FUNCTION control.set_updated_at();
CREATE TRIGGER controller_mqtt_retained_cleanup_updated_at BEFORE UPDATE ON control.controller_mqtt_retained_cleanup
    FOR EACH ROW EXECUTE FUNCTION control.set_updated_at();

INSERT INTO control.schema_version (singleton_key, version) VALUES (1, 1);
