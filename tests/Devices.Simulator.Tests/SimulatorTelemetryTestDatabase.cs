using Microsoft.Extensions.Configuration;
using Npgsql;

internal static class SimulatorTelemetryTestDatabase
{
    private const string ConnectionEnvironmentVariable = "DEVICES_TEST_TELEMETRY_CONNECTION";
    private const string RequiredDatabasePrefix = "devices_control_test_";

    public static string ConnectionString
    {
        get
        {
            var value = Environment.GetEnvironmentVariable(ConnectionEnvironmentVariable);
            if (string.IsNullOrWhiteSpace(value))
                throw new InvalidOperationException($"{ConnectionEnvironmentVariable} must point to the isolated PostgreSQL telemetry test database.");
            var builder = new NpgsqlConnectionStringBuilder(value);
            if (builder.Database is not { } database ||
                !database.StartsWith(RequiredDatabasePrefix, StringComparison.Ordinal))
                throw new InvalidOperationException($"Simulator MQTT tests only run against an explicitly isolated '{RequiredDatabasePrefix}…' database.");
            return builder.ConnectionString;
        }
    }

    public static void Reset(IConfiguration configuration)
    {
        _ = new TelemetryStore(configuration);
        using var connection = new NpgsqlConnection(ConnectionString);
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = """
            TRUNCATE TABLE telemetry.telemetry_events, telemetry.controller_latest,
                telemetry.controller_observed, telemetry.controller_design_revision,
                telemetry.controller_authoritative, telemetry.controller_tombstones CASCADE;
            """;
        command.ExecuteNonQuery();
    }
}
