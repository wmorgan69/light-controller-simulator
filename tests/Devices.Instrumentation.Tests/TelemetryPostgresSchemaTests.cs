using Devices.Contracts;
using Microsoft.Extensions.Configuration;
using Npgsql;

[Collection(TelemetryDatabaseCollection.Name)]
public sealed class TelemetryPostgresSchemaTests
{
    public TelemetryPostgresSchemaTests() => TelemetryTestDatabase.Reset();

    [Fact]
    public void ApplicationOwnedTablePrimaryKeysAreGeneratedAsUuidV7()
    {
        var controllers = DeviceIds.CreateBuilding().Take(2).ToArray();
        var store = new TelemetryStore(TelemetryTestDatabase.Configuration());
        Assert.True(store.ApplySnapshot(new(1, controllers)));
        var state = controllers[0] with { Revision = controllers[0].Revision + 1 };
        store.Ingest(new DeviceTelemetry("schema-event", controllers[0].Id, "state.changed",
            DateTimeOffset.UtcNow, state));
        Assert.True(store.ApplySnapshot(new(2, [controllers[0]])));

        using var connection = Open();
        foreach (var table in new[]
        {
            "schema_version", "telemetry_events", "controller_latest", "controller_observed",
            "controller_design_revision", "controller_authoritative", "controller_tombstones"
        })
        {
            using var command = connection.CreateCommand();
            command.CommandText = $"SELECT count(*), count(*) FILTER (WHERE uuid_extract_version(id) IS DISTINCT FROM 7) FROM telemetry.{table}";
            using var reader = command.ExecuteReader();
            Assert.True(reader.Read());
            Assert.True(reader.GetInt64(0) > 0, $"Expected UUIDv7 primary keys in telemetry.{table}.");
            Assert.Equal(0L, reader.GetInt64(1));
        }

        using var eventCommand = connection.CreateCommand();
        eventCommand.CommandText = "SELECT event_id FROM telemetry.telemetry_events WHERE event_id = 'schema-event'";
        Assert.Equal("schema-event", eventCommand.ExecuteScalar());
    }

    [Fact]
    public void StableIdsAndRelationalConstraintsRemainEnforced()
    {
        var controller = DeviceIds.CreateBuilding().First();
        var store = new TelemetryStore(TelemetryTestDatabase.Configuration());
        Assert.True(store.ApplySnapshot(new(1, [controller])));
        store.Ingest(new DeviceTelemetry("unique-event", controller.Id, "state.changed",
            DateTimeOffset.UtcNow, controller with { Revision = controller.Revision + 1 }));

        using var connection = Open();
        Assert.Equal(PostgresErrorCodes.UniqueViolation, Assert.Throws<PostgresException>(() =>
            Execute(connection, """
                INSERT INTO telemetry.telemetry_events (event_id, controller_id, event_type, timestamp, payload)
                VALUES ('unique-event', 'other-controller', 'state.changed', now(), '{}')
                """)).SqlState);
        Assert.Equal(PostgresErrorCodes.UniqueViolation, Assert.Throws<PostgresException>(() =>
            Execute(connection, """
                INSERT INTO telemetry.controller_design_revision (singleton, revision)
                VALUES (true, 2)
                """)).SqlState);
        Assert.Equal(PostgresErrorCodes.ForeignKeyViolation, Assert.Throws<PostgresException>(() =>
            Execute(connection, """
                INSERT INTO telemetry.controller_observed (controller_id, observed_at)
                VALUES ('not-a-controller', now())
                """)).SqlState);
    }

    [Fact]
    public void FreshSchemaHasVersionTableAndTimestampsOnEveryTable()
    {
        using (var connection = Open())
            Execute(connection, """
                DROP TABLE telemetry.schema_version, telemetry.telemetry_events, telemetry.controller_latest,
                    telemetry.controller_observed, telemetry.controller_design_revision,
                    telemetry.controller_authoritative, telemetry.controller_tombstones CASCADE;
                DROP FUNCTION telemetry.set_updated_at();
                """);
        var store = new TelemetryStore(TelemetryTestDatabase.Configuration());
        try
        {
            var controllers = DeviceIds.CreateBuilding().Take(2).ToArray();
            Assert.True(store.ApplySnapshot(new(1, controllers)));
            store.Ingest(new DeviceTelemetry("timestamp-event", controllers[0].Id, "state.changed",
                DateTimeOffset.UtcNow, controllers[0] with { Revision = controllers[0].Revision + 1 }));
            Assert.True(store.ApplySnapshot(new(2, [controllers[0]])));

            using var connection = Open();
            using (var command = connection.CreateCommand())
            {
                command.CommandText = "SELECT to_regclass('telemetry.schema_version') IS NOT NULL AND to_regclass('telemetry.schema_migrations') IS NULL";
                Assert.True((bool)command.ExecuteScalar()!);
            }

            foreach (var table in new[]
            {
                "schema_version", "telemetry_events", "controller_latest", "controller_observed",
                "controller_design_revision", "controller_authoritative", "controller_tombstones"
            })
            {
                using var command = connection.CreateCommand();
                command.CommandText = """
                    SELECT count(*) FROM information_schema.columns
                    WHERE table_schema = 'telemetry' AND table_name = @table
                      AND column_name IN ('created_at', 'updated_at')
                      AND data_type = 'timestamp with time zone'
                      AND is_nullable = 'NO' AND column_default = 'clock_timestamp()'
                    """;
                command.Parameters.AddWithValue("table", table);
                Assert.Equal(2L, (long)command.ExecuteScalar()!);
                command.CommandText = $"SELECT created_at FROM telemetry.{table} LIMIT 1";
                var createdAt = Assert.IsType<DateTime>(command.ExecuteScalar());
                command.CommandText = $"""
                    UPDATE telemetry.{table} SET updated_at = '2000-01-01 00:00:00+00'
                    RETURNING created_at, updated_at
                    """;
                using var reader = command.ExecuteReader();
                Assert.True(reader.Read(), $"Expected a row in telemetry.{table}.");
                Assert.Equal(createdAt, reader.GetDateTime(0));
                Assert.True(reader.GetDateTime(1) > new DateTime(2000, 1, 1, 0, 0, 0, DateTimeKind.Utc));
            }
        }
        finally
        {
            TelemetryTestDatabase.Reset();
        }
    }

    [Fact]
    public void UnsupportedAndUnversionedSchemasFailExplicitly()
    {
        using (var connection = Open())
            Execute(connection, "UPDATE telemetry.schema_version SET version = 999 WHERE singleton = true");
        try
        {
            Assert.Contains("Unsupported telemetry schema version", Assert.Throws<InvalidOperationException>(() =>
                new TelemetryStore(TelemetryTestDatabase.Configuration())).Message);
        }
        finally
        {
            using var connection = Open();
            Execute(connection, "UPDATE telemetry.schema_version SET version = 1 WHERE singleton = true");
        }

        using (var connection = Open())
            Execute(connection, "DELETE FROM telemetry.schema_version");
        try
        {
            Assert.Contains("no migration version", Assert.Throws<InvalidOperationException>(() =>
                new TelemetryStore(TelemetryTestDatabase.Configuration())).Message);
        }
        finally
        {
            using var connection = Open();
            Execute(connection, """
                INSERT INTO telemetry.schema_version (singleton, version) VALUES (true, 1)
                ON CONFLICT (singleton) DO UPDATE SET version = EXCLUDED.version
                """);
        }

        using (var connection = Open())
            Execute(connection, "ALTER TABLE telemetry.schema_version RENAME TO schema_version_unversioned");
        try
        {
            Assert.Contains("unversioned objects", Assert.Throws<InvalidOperationException>(() =>
                new TelemetryStore(TelemetryTestDatabase.Configuration())).Message);
        }
        finally
        {
            using var connection = Open();
            Execute(connection, "ALTER TABLE telemetry.schema_version_unversioned RENAME TO schema_version");
        }

        using (var connection = Open())
            Execute(connection, "ALTER TABLE telemetry.controller_tombstones RENAME TO controller_tombstones_partial");
        try
        {
            Assert.Equal("42P01", Assert.Throws<PostgresException>(() =>
                new TelemetryStore(TelemetryTestDatabase.Configuration())).SqlState);
        }
        finally
        {
            using var connection = Open();
            Execute(connection, "ALTER TABLE telemetry.controller_tombstones_partial RENAME TO controller_tombstones");
        }
    }

    [Fact]
    public void MissingTelemetryConnectionStringFailsBeforeConnecting()
    {
        var configuration = new ConfigurationBuilder().Build();

        Assert.Contains("ConnectionStrings:Telemetry", Assert.Throws<InvalidOperationException>(() =>
            new TelemetryStore(configuration)).Message);
    }

    [Fact]
    public void LegacyVersionTableIsRejectedWithoutChangingTelemetry()
    {
        var store = new TelemetryStore(TelemetryTestDatabase.Configuration());
        Assert.True(store.ApplySnapshot(new(1, [DeviceIds.CreateBuilding().First()])));
        using (var connection = Open())
            Execute(connection, "ALTER TABLE telemetry.schema_version RENAME TO schema_migrations");
        try
        {
            var error = Assert.Throws<InvalidOperationException>(() => new TelemetryStore(TelemetryTestDatabase.Configuration()));
            Assert.Contains("legacy schema_migrations", error.Message);
            using var connection = Open();
            using var command = connection.CreateCommand();
            command.CommandText = """
                SELECT (SELECT version FROM telemetry.schema_migrations WHERE singleton = true),
                       (SELECT count(*) FROM telemetry.controller_latest),
                       to_regclass('telemetry.schema_version') IS NULL
                """;
            using var reader = command.ExecuteReader();
            Assert.True(reader.Read());
            Assert.Equal(1, reader.GetInt32(0));
            Assert.Equal(1L, reader.GetInt64(1));
            Assert.True(reader.GetBoolean(2));
        }
        finally
        {
            using var connection = Open();
            Execute(connection, "ALTER TABLE telemetry.schema_migrations RENAME TO schema_version");
        }
    }

    [Fact]
    public void MixedLegacyAndCurrentVersionTablesAreRejected()
    {
        using (var connection = Open())
            Execute(connection, "CREATE TABLE telemetry.schema_migrations AS SELECT * FROM telemetry.schema_version");
        try
        {
            var error = Assert.Throws<InvalidOperationException>(() => new TelemetryStore(TelemetryTestDatabase.Configuration()));
            Assert.Contains("legacy schema_migrations", error.Message);
        }
        finally
        {
            using var connection = Open();
            Execute(connection, "DROP TABLE telemetry.schema_migrations");
        }
    }

    [Fact]
    public void IncompleteTimestampTrackingIsRejectedWithoutChangingData()
    {
        var store = new TelemetryStore(TelemetryTestDatabase.Configuration());
        Assert.True(store.ApplySnapshot(new(1, [DeviceIds.CreateBuilding().First()])));
        using (var connection = Open())
            Execute(connection, "ALTER TABLE telemetry.controller_latest DISABLE TRIGGER controller_latest_updated_at");
        try
        {
            var error = Assert.Throws<InvalidOperationException>(() => new TelemetryStore(TelemetryTestDatabase.Configuration()));
            Assert.Contains("incomplete timestamp tracking", error.Message);
            using var connection = Open();
            using var command = connection.CreateCommand();
            command.CommandText = "SELECT count(*) FROM telemetry.controller_latest";
            Assert.Equal(1L, (long)command.ExecuteScalar()!);
        }
        finally
        {
            using var connection = Open();
            Execute(connection, "ALTER TABLE telemetry.controller_latest ENABLE TRIGGER controller_latest_updated_at");
        }
    }

    [Theory]
    [InlineData("ALTER COLUMN created_at DROP DEFAULT", "ALTER COLUMN created_at SET DEFAULT clock_timestamp()")]
    [InlineData("ALTER COLUMN updated_at DROP NOT NULL", "ALTER COLUMN updated_at SET NOT NULL")]
    [InlineData("ALTER COLUMN created_at TYPE timestamp", "ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC'")]
    public void InvalidTimestampColumnsAreRejected(string change, string restore)
    {
        using (var connection = Open())
            Execute(connection, $"ALTER TABLE telemetry.controller_latest {change}");
        try
        {
            var error = Assert.Throws<InvalidOperationException>(() => new TelemetryStore(TelemetryTestDatabase.Configuration()));
            Assert.Contains("incomplete timestamp tracking", error.Message);
        }
        finally
        {
            using var connection = Open();
            Execute(connection, $"ALTER TABLE telemetry.controller_latest {restore}");
        }
    }

    [Theory]
    [InlineData("UPDATE OF payload", "")]
    [InlineData("UPDATE", "WHEN (OLD.payload IS DISTINCT FROM NEW.payload)")]
    public void PartialUpdateTriggersAreRejected(string updateEvent, string condition)
    {
        using (var connection = Open())
            Execute(connection, $"""
                DROP TRIGGER controller_latest_updated_at ON telemetry.controller_latest;
                CREATE TRIGGER controller_latest_updated_at BEFORE {updateEvent} ON telemetry.controller_latest
                    FOR EACH ROW {condition} EXECUTE FUNCTION telemetry.set_updated_at();
                """);
        try
        {
            var error = Assert.Throws<InvalidOperationException>(() => new TelemetryStore(TelemetryTestDatabase.Configuration()));
            Assert.Contains("incomplete timestamp tracking", error.Message);
        }
        finally
        {
            using var connection = Open();
            Execute(connection, """
                DROP TRIGGER controller_latest_updated_at ON telemetry.controller_latest;
                CREATE TRIGGER controller_latest_updated_at BEFORE UPDATE ON telemetry.controller_latest
                    FOR EACH ROW EXECUTE FUNCTION telemetry.set_updated_at();
                """);
        }
    }

    [Fact]
    public void InstrumentationRoleHasNoControlSchemaAccess()
    {
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT has_schema_privilege(current_user, 'control', 'USAGE')";

        Assert.False((bool)command.ExecuteScalar()!);
        Assert.Equal("42501", Assert.Throws<PostgresException>(() =>
            Execute(connection, "SELECT 1 FROM control.schema_version")).SqlState);
    }

    private static NpgsqlConnection Open()
    {
        var connection = new NpgsqlConnection(TelemetryTestDatabase.ConnectionString);
        connection.Open();
        return connection;
    }

    private static void Execute(NpgsqlConnection connection, string sql)
    {
        using var command = connection.CreateCommand();
        command.CommandText = sql;
        command.ExecuteNonQuery();
    }
}
