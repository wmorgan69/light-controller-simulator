using Microsoft.Extensions.Configuration;
using Npgsql;

[CollectionDefinition(TelemetryDatabaseCollection.Name, DisableParallelization = true)]
public sealed class TelemetryDatabaseCollection
{
    public const string Name = "Telemetry PostgreSQL database";
}

public static class TelemetryTestDatabase
{
    private static readonly Lazy<string> configuredConnectionString = new(() =>
    {
        var value = Environment.GetEnvironmentVariable("INSTRUMENTATION_TEST_CONNECTION_STRING");
        if (string.IsNullOrWhiteSpace(value))
            throw new InvalidOperationException(
                "Set INSTRUMENTATION_TEST_CONNECTION_STRING to an isolated PostgreSQL 18 test database.");

        var builder = new NpgsqlConnectionStringBuilder(value);
        if (!(builder.Database ?? "").StartsWith("devices_instrumentation_test", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException(
                "Instrumentation tests may only modify a database named devices_instrumentation_test or devices_instrumentation_test_*.");
        return builder.ConnectionString;
    });

    public static string ConnectionString => configuredConnectionString.Value;

    public static IConfiguration Configuration(IReadOnlyDictionary<string, string?>? additionalSettings = null)
    {
        var settings = new Dictionary<string, string?>
        {
            ["ConnectionStrings:Telemetry"] = ConnectionString
        };
        if (additionalSettings is not null)
            foreach (var setting in additionalSettings)
                settings[setting.Key] = setting.Value;
        return new ConfigurationBuilder().AddInMemoryCollection(settings).Build();
    }

    public static void Reset()
    {
        _ = new TelemetryStore(Configuration());
        using var connection = new NpgsqlConnection(ConnectionString);
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = """
            TRUNCATE TABLE telemetry.telemetry_events,
                telemetry.controller_latest,
                telemetry.controller_observed,
                telemetry.controller_design_revision,
                telemetry.controller_authoritative,
                telemetry.controller_tombstones CASCADE
            """;
        command.ExecuteNonQuery();
    }
}
