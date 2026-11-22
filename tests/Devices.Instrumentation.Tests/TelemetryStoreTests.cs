using Devices.Contracts;
using Microsoft.Extensions.Configuration;
using Xunit;

public class TelemetryStoreTests
{
    [Fact]
    public void StoreKeepsLatestControllerAndRecentEvent()
    {
        var store = new TelemetryStore(new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Telemetry:SqlitePath"] = Path.Combine(Path.GetTempPath(), $"telemetry-{Guid.NewGuid():N}.db")
            }).Build());
        var controller = DeviceIds.CreateBuilding().First();
        var telemetry = new DeviceTelemetry("event-1", controller.Id, "state.changed",
            DateTimeOffset.UtcNow, controller);

        store.Ingest(telemetry);

        Assert.Equal(controller.Id, store.GetSnapshot().Single().Id);
        Assert.Equal("event-1", store.GetEvents().Single().EventId);
    }

    [Fact]
    public void SnapshotMarksUnobservedControllerOffline()
    {
        var store = new TelemetryStore(new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Telemetry:SqlitePath"] = Path.Combine(Path.GetTempPath(), $"telemetry-{Guid.NewGuid():N}.db"),
                ["Telemetry:StaleAfterSeconds"] = "0"
            }).Build());
        var controller = DeviceIds.CreateBuilding().First();
        store.Ingest(new DeviceTelemetry("event-1", controller.Id, "state.changed",
            DateTimeOffset.UtcNow, controller));

        Assert.Equal(ControllerStatus.Offline, store.GetSnapshot().Single().Status);
    }

    [Fact]
    public void StoreIgnoresOlderTelemetryRevision()
    {
        var store = new TelemetryStore(new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Telemetry:SqlitePath"] = Path.Combine(Path.GetTempPath(), $"telemetry-{Guid.NewGuid():N}.db")
            }).Build());
        var controller = DeviceIds.CreateBuilding().First();
        var newer = controller with
        {
            Revision = 2,
            Status = ControllerStatus.Faulted
        };
        var older = controller with { Revision = 1 };

        store.Ingest(new DeviceTelemetry("event-new", controller.Id, "fault.changed",
            DateTimeOffset.UtcNow, newer));
        store.Ingest(new DeviceTelemetry("event-old", controller.Id, "state.changed",
            DateTimeOffset.UtcNow, older));

        Assert.Equal(ControllerStatus.Faulted, store.GetSnapshot().Single().Status);
        Assert.Equal("event-new", store.GetEvents().First().EventId);
    }

    [Fact]
    public void UnchangedObservedStateRemainsHealthy()
    {
        var store = new TelemetryStore(new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Telemetry:SqlitePath"] = Path.Combine(Path.GetTempPath(), $"telemetry-{Guid.NewGuid():N}.db"),
                ["Telemetry:StaleAfterSeconds"] = "30"
            }).Build());
        var controller = DeviceIds.CreateBuilding().First();

        store.Ingest(new DeviceTelemetry("event-1", controller.Id, "state.changed",
            DateTimeOffset.UtcNow, controller));
        store.Observe(controller.Id);

        Assert.Equal(ControllerStatus.Healthy, store.GetSnapshot().Single().Status);
    }

    [Fact]
    public void StoreRestoresPersistedRecentEvents()
    {
        var sqlitePath = Path.Combine(Path.GetTempPath(), $"telemetry-{Guid.NewGuid():N}.db");
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Telemetry:SqlitePath"] = sqlitePath
            }).Build();
        var controller = DeviceIds.CreateBuilding().First();
        var telemetry = new DeviceTelemetry("event-persisted", controller.Id, "state.changed",
            DateTimeOffset.UtcNow, controller);

        var firstStore = new TelemetryStore(configuration);
        firstStore.Ingest(telemetry);

        var restartedStore = new TelemetryStore(configuration);

        Assert.Equal("event-persisted", restartedStore.GetEvents().Single().EventId);
    }

    [Fact]
    public void FallbackChangeCreatesEventWithEqualRevision()
    {
        var store = new TelemetryStore(new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Telemetry:SqlitePath"] = Path.Combine(Path.GetTempPath(), $"telemetry-{Guid.NewGuid():N}.db")
            }).Build());
        var controller = DeviceIds.CreateBuilding().First();
        var changed = controller with
        {
            Revision = controller.Revision,
            Status = ControllerStatus.Faulted
        };

        store.IngestFallbackChange(new DeviceTelemetry("fallback-1", controller.Id, "fault.changed",
            DateTimeOffset.UtcNow, changed));

        Assert.Equal(ControllerStatus.Faulted, store.GetSnapshot().Single().Status);
        Assert.Equal("fallback-1", store.GetEvents().Single().EventId);
    }

    [Fact]
    public void FallbackChangeAcceptsRestartedLowerRevision()
    {
        var store = new TelemetryStore(new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Telemetry:SqlitePath"] = Path.Combine(Path.GetTempPath(), $"telemetry-{Guid.NewGuid():N}.db")
            }).Build());
        var controller = DeviceIds.CreateBuilding().First();
        var persisted = controller with { Revision = 100, Status = ControllerStatus.Faulted };
        var restarted = controller with { Revision = 1, Status = ControllerStatus.Healthy };

        store.IngestFallbackChange(new DeviceTelemetry("persisted", controller.Id, "fault.changed",
            DateTimeOffset.UtcNow, persisted));
        store.IngestFallbackChange(new DeviceTelemetry("restarted", controller.Id, "state.changed",
            DateTimeOffset.UtcNow, restarted));

        Assert.Equal(ControllerStatus.Healthy, store.GetSnapshot().Single().Status);
        Assert.Equal("restarted", store.GetEvents().First().EventId);
    }
}
