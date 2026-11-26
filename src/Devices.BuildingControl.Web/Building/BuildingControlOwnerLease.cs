using Npgsql;

public sealed class BuildingControlOwnerLease(
    string connectionString,
    IHostApplicationLifetime applicationLifetime,
    ILogger<BuildingControlOwnerLease> logger) : IHostedService, IAsyncDisposable
{
    private const int LockKey = 1936028789;
    private NpgsqlConnection? connection;
    private CancellationTokenSource? monitorCancellation;
    private Task? monitorTask;

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        var settings = new NpgsqlConnectionStringBuilder(connectionString)
        {
            Pooling = false,
            Timeout = 5,
            CommandTimeout = 3
        };
        var candidate = new NpgsqlConnection(settings.ConnectionString);
        try
        {
            await candidate.OpenAsync(cancellationToken);
            await using var command = candidate.CreateCommand();
            command.CommandText = """
                SELECT pg_try_advisory_lock(
                    (SELECT oid::integer FROM pg_database WHERE datname = current_database()), @key)
                """;
            command.Parameters.AddWithValue("key", LockKey);
            if (await command.ExecuteScalarAsync(cancellationToken) is not true)
                throw new InvalidOperationException("Another Building Control simulator process already owns this database.");
            connection = candidate;
            monitorCancellation = new CancellationTokenSource();
            monitorTask = MonitorAsync(candidate, monitorCancellation.Token);
        }
        catch
        {
            await candidate.DisposeAsync();
            throw;
        }
    }

    public async Task StopAsync(CancellationToken cancellationToken)
    {
        if (monitorCancellation is not null)
            await monitorCancellation.CancelAsync();
        if (monitorTask is not null)
            await monitorTask;
        var activeConnection = Interlocked.Exchange(ref connection, null);
        if (activeConnection is not null)
            await activeConnection.DisposeAsync();
        monitorCancellation?.Dispose();
        monitorCancellation = null;
        monitorTask = null;
    }

    private async Task MonitorAsync(NpgsqlConnection leaseConnection, CancellationToken cancellationToken)
    {
        try
        {
            using var timer = new PeriodicTimer(TimeSpan.FromSeconds(1));
            while (await timer.WaitForNextTickAsync(cancellationToken))
            {
                using var probeTimeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
                probeTimeout.CancelAfter(TimeSpan.FromSeconds(3));
                await using var command = leaseConnection.CreateCommand();
                command.CommandText = "SELECT 1";
                await command.ExecuteScalarAsync(probeTimeout.Token);
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
        }
        catch (Exception exception)
        {
            if (cancellationToken.IsCancellationRequested) return;
            logger.LogError(exception,
                "Building Control lost its PostgreSQL owner lease connection; stopping the application.");
            applicationLifetime.StopApplication();
        }
    }

    public ValueTask DisposeAsync() => new(StopAsync(CancellationToken.None));
}
