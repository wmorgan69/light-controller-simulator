using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;

public sealed class BuildingControlOwnerLeaseTests
{
    [Fact]
    public async Task SecondSimulatorOwnerFailsFastUntilTheFirstProcessReleasesItsLease()
    {
        using var lifetime = new TestApplicationLifetime();
        var first = CreateLease(lifetime);
        await first.StartAsync(CancellationToken.None);
        try
        {
            await using var second = CreateLease(lifetime);
            var conflict = await Assert.ThrowsAsync<InvalidOperationException>(
                () => second.StartAsync(CancellationToken.None));
            Assert.Contains("already owns", conflict.Message);
        }
        finally
        {
            await first.StopAsync(CancellationToken.None);
        }

        var next = CreateLease(lifetime);
        await next.StartAsync(CancellationToken.None);
        await next.StopAsync(CancellationToken.None);
        Assert.False(lifetime.ApplicationStopping.IsCancellationRequested);
    }

    [Fact]
    public async Task LostLeaseConnectionReportsAnErrorAndStopsTheApplication()
    {
        using var lifetime = new TestApplicationLifetime();
        var logger = new TestLogger();
        var settings = new NpgsqlConnectionStringBuilder(ControlTestDatabase.ConnectionString)
        {
            ApplicationName = $"control-owner-loss-test-{Guid.NewGuid():N}"
        };
        await using var lease = new BuildingControlOwnerLease(settings.ConnectionString, lifetime, logger);
        await lease.StartAsync(CancellationToken.None);

        using var connection = new NpgsqlConnection(ControlTestDatabase.ConnectionString);
        await connection.OpenAsync();
        await using var terminate = connection.CreateCommand();
        terminate.CommandText = """
            SELECT pg_terminate_backend(pid) FROM pg_stat_activity
            WHERE datname = current_database() AND usename = current_user
                AND application_name = @name AND pid <> pg_backend_pid()
            """;
        terminate.Parameters.AddWithValue("name", settings.ApplicationName!);
        Assert.Equal(true, await terminate.ExecuteScalarAsync());

        await lifetime.Stopped.Task.WaitAsync(TimeSpan.FromSeconds(10));
        Assert.True(lifetime.ApplicationStopping.IsCancellationRequested);
        Assert.Equal(LogLevel.Error, logger.Level);
        Assert.Contains("owner lease connection", logger.Message);
        await lease.StopAsync(CancellationToken.None);

        using var nextLifetime = new TestApplicationLifetime();
        await using var next = CreateLease(nextLifetime);
        await next.StartAsync(CancellationToken.None);
        await next.StopAsync(CancellationToken.None);
        Assert.False(nextLifetime.ApplicationStopping.IsCancellationRequested);
    }

    private static BuildingControlOwnerLease CreateLease(TestApplicationLifetime lifetime) =>
        new(ControlTestDatabase.ConnectionString, lifetime, NullLogger<BuildingControlOwnerLease>.Instance);

    private sealed class TestApplicationLifetime : IHostApplicationLifetime, IDisposable
    {
        private readonly CancellationTokenSource stopping = new();
        public TaskCompletionSource Stopped { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public CancellationToken ApplicationStarted => CancellationToken.None;
        public CancellationToken ApplicationStopping => stopping.Token;
        public CancellationToken ApplicationStopped => CancellationToken.None;
        public void StopApplication()
        {
            stopping.Cancel();
            Stopped.TrySetResult();
        }
        public void Dispose() => stopping.Dispose();
    }

    private sealed class TestLogger : ILogger<BuildingControlOwnerLease>
    {
        public LogLevel? Level { get; private set; }
        public string Message { get; private set; } = "";
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel logLevel) => true;
        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception,
            Func<TState, Exception?, string> formatter)
        {
            Level = logLevel;
            Message = formatter(state, exception);
        }
    }
}
