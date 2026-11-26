using Npgsql;

internal static class ControlTestDatabase
{
    private const string ConnectionEnvironmentVariable = "DEVICES_TEST_CONTROL_CONNECTION";
    private const string RequiredDatabasePrefix = "devices_control_test_";

    public static string ConnectionString
    {
        get
        {
            var value = Environment.GetEnvironmentVariable(ConnectionEnvironmentVariable);
            if (string.IsNullOrWhiteSpace(value))
                throw new InvalidOperationException($"{ConnectionEnvironmentVariable} must point to the isolated PostgreSQL test database.");
            var builder = new NpgsqlConnectionStringBuilder(value);
            if (builder.Database is not { } database ||
                !database.StartsWith(RequiredDatabasePrefix, StringComparison.Ordinal))
                throw new InvalidOperationException($"Simulator persistence tests only run against an explicitly isolated '{RequiredDatabasePrefix}…' database.");
            return builder.ConnectionString;
        }
    }

    public static void Reset()
    {
        using var connection = new NpgsqlConnection(ConnectionString);
        connection.Open();
        using (var command = connection.CreateCommand())
        {
            command.CommandText = """
                DROP TABLE IF EXISTS control.controller_mqtt_retained_cleanup;
                DROP TABLE IF EXISTS control.retired_design_entity_id;
                DROP TABLE IF EXISTS control.building, control.building_design CASCADE;
                DROP TABLE IF EXISTS control.controller_cleanup;
                DROP TABLE IF EXISTS control.retired_design_id;
                DROP TABLE IF EXISTS control.schema_version;
                DROP FUNCTION IF EXISTS control.set_updated_at();
                DROP FUNCTION IF EXISTS control.test_reject_design_write();
                DROP FUNCTION IF EXISTS control.test_reject_activation();
                """;
            command.ExecuteNonQuery();
        }

        _ = new BuildingDesignStore(ConnectionString);
    }

    public static void Execute(string sql)
    {
        using var connection = new NpgsqlConnection(ConnectionString);
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = sql;
        command.ExecuteNonQuery();
    }

    public static object? Scalar(string sql)
    {
        using var connection = new NpgsqlConnection(ConnectionString);
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = sql;
        return command.ExecuteScalar();
    }
}
