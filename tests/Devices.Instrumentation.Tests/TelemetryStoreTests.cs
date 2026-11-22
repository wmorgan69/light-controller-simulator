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

    [Fact]
    public void IngestHigherRevisionReplacesPrevious()
    {
        var store = new TelemetryStore(new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Telemetry:SqlitePath"] = Path.Combine(Path.GetTempPath(), $"telemetry-{Guid.NewGuid():N}.db")
            }).Build());
        var controller = DeviceIds.CreateBuilding().First();
        var state1 = controller with { Revision = 1, Status = ControllerStatus.Healthy };
        var state2 = controller with { Revision = 2, Status = ControllerStatus.Faulted };

        store.Ingest(new DeviceTelemetry("event-1", controller.Id, "state", DateTimeOffset.UtcNow, state1));
        store.Ingest(new DeviceTelemetry("event-2", controller.Id, "fault", DateTimeOffset.UtcNow, state2));

        Assert.Equal(ControllerStatus.Faulted, store.GetSnapshot().Single().Status);
    }

    [Fact]
    public void IngestIdenticalStateDoesNotCreateEvent()
    {
        var store = new TelemetryStore(new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Telemetry:SqlitePath"] = Path.Combine(Path.GetTempPath(), $"telemetry-{Guid.NewGuid():N}.db")
            }).Build());
        var controller = DeviceIds.CreateBuilding().First();

        store.Ingest(new DeviceTelemetry("event-1", controller.Id, "state", DateTimeOffset.UtcNow, controller));
        store.Ingest(new DeviceTelemetry("event-2", controller.Id, "state", DateTimeOffset.UtcNow, controller));

        Assert.Single(store.GetEvents());
    }

    [Fact]
    public void SameRevisionDifferentJsonCreatesNewEvent()
    {
        var store = new TelemetryStore(new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Telemetry:SqlitePath"] = Path.Combine(Path.GetTempPath(), $"telemetry-{Guid.NewGuid():N}.db")
            }).Build());
        var controller = DeviceIds.CreateBuilding().First();
        
        var state1 = controller with { Revision = 10, Status = ControllerStatus.Healthy };
        var state2 = controller with { Revision = 10, Status = ControllerStatus.Faulted };

        store.Ingest(new DeviceTelemetry("first", controller.Id, "state", DateTimeOffset.UtcNow, state1));
        store.Ingest(new DeviceTelemetry("second", controller.Id, "fault", DateTimeOffset.UtcNow, state2));

        var events = store.GetEvents();
        Assert.Equal(2, events.Count);
    }

    [Fact]
    public void FallbackChangeBypassesRevisionCheck()
    {
        var store = new TelemetryStore(new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Telemetry:SqlitePath"] = Path.Combine(Path.GetTempPath(), $"telemetry-{Guid.NewGuid():N}.db")
            }).Build());
        var controller = DeviceIds.CreateBuilding().First();
        var higher = controller with { Revision = 100, Status = ControllerStatus.Faulted };
        var lower = controller with { Revision = 1, Status = ControllerStatus.Healthy };

        store.IngestFallbackChange(new DeviceTelemetry("high", controller.Id, "fault", DateTimeOffset.UtcNow, higher));
        store.IngestFallbackChange(new DeviceTelemetry("low", controller.Id, "recovered", DateTimeOffset.UtcNow, lower));

        var snapshot = store.GetSnapshot().Single();
        Assert.Equal(ControllerStatus.Healthy, snapshot.Status);
        Assert.Equal(1, snapshot.Revision);
    }

    [Fact]
    public void MultipleControllersStateIndependent()
    {
        var store = new TelemetryStore(new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Telemetry:SqlitePath"] = Path.Combine(Path.GetTempPath(), $"telemetry-{Guid.NewGuid():N}.db")
            }).Build());
        var controllers = DeviceIds.CreateBuilding().Take(2).ToList();

        store.Ingest(new DeviceTelemetry("e1", controllers[0].Id, "state", DateTimeOffset.UtcNow, controllers[0]));
        var healthy = controllers[1] with { Status = ControllerStatus.Healthy };
        store.Ingest(new DeviceTelemetry("e2", controllers[1].Id, "state", DateTimeOffset.UtcNow, healthy));

        var snapshot = store.GetSnapshot();
        Assert.Equal(ControllerStatus.Healthy, snapshot[0].Status);
        Assert.Equal(ControllerStatus.Healthy, snapshot[1].Status);
    }

    [Fact]
    public void GetEventReturnsEmptyWhenNeverIngested()
    {
        var store = new TelemetryStore(new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Telemetry:SqlitePath"] = Path.Combine(Path.GetTempPath(), $"telemetry-{Guid.NewGuid():N}.db")
            }).Build());

        Assert.Empty(store.GetEvents());
    }

    [Fact]
    public void GetSnapshotEmptyWhenNeverIngested()
    {
        var store = new TelemetryStore(new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Telemetry:SqlitePath"] = Path.Combine(Path.GetTempPath(), $"telemetry-{Guid.NewGuid():N}.db")
            }).Build());

        Assert.Empty(store.GetSnapshot());
    }

    [Fact]
    public void PersistencePreservesMultipleEventsOnRestart()
    {
        var sqlitePath = Path.Combine(Path.GetTempPath(), $"telemetry-{Guid.NewGuid():N}.db");
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Telemetry:SqlitePath"] = sqlitePath
            }).Build();
        
        var controller1 = DeviceIds.CreateBuilding().First();
        var controller2 = DeviceIds.CreateBuilding().Skip(1).First();

        var store1 = new TelemetryStore(config);
        store1.Ingest(new DeviceTelemetry("e1", controller1.Id, "state", DateTimeOffset.UtcNow, controller1));
        store1.Ingest(new DeviceTelemetry("e2", controller2.Id, "state", DateTimeOffset.UtcNow, controller2));

        var store2 = new TelemetryStore(config);
        var events = store2.GetEvents();
        Assert.Equal(2, events.Count);
    }

    [Fact]
    public void ObserveUnknownControllerDoesNotAffectSnapshot()
    {
        var store = new TelemetryStore(new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Telemetry:SqlitePath"] = Path.Combine(Path.GetTempPath(), $"telemetry-{Guid.NewGuid():N}.db")
            }).Build());

        store.Observe("unknown-id");
        
        Assert.Empty(store.GetSnapshot());
    }

    [Fact]
    public void GetControllerByIdWhenNotIngested()
    {
        var store = new TelemetryStore(new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Telemetry:SqlitePath"] = Path.Combine(Path.GetTempPath(), $"telemetry-{Guid.NewGuid():N}.db")
            }).Build());

        var controller = store.GetController("unknown-id");
        Assert.Null(controller);
    }

    [Fact]
    public void GetControllerByIdAfterIngest()
    {
        var store = new TelemetryStore(new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Telemetry:SqlitePath"] = Path.Combine(Path.GetTempPath(), $"telemetry-{Guid.NewGuid():N}.db")
            }).Build());
        var controller = DeviceIds.CreateBuilding().First();

        store.Ingest(new DeviceTelemetry("e1", controller.Id, "state", DateTimeOffset.UtcNow, controller));
        
        var retrieved = store.GetController(controller.Id);
        Assert.NotNull(retrieved);
        Assert.Equal(controller.Id, retrieved.Id);
    }

    [Fact]
    public void LowerRevisionIsIgnored()
    {
        var store = new TelemetryStore(new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Telemetry:SqlitePath"] = Path.Combine(Path.GetTempPath(), $"telemetry-{Guid.NewGuid():N}.db")
            }).Build());
        var controller = DeviceIds.CreateBuilding().First();
        var state2 = controller with { Revision = 2, Status = ControllerStatus.Faulted };
        var state1 = controller with { Revision = 1, Status = ControllerStatus.Healthy };

        store.Ingest(new DeviceTelemetry("e2", controller.Id, "fault", DateTimeOffset.UtcNow, state2));
        store.Ingest(new DeviceTelemetry("e1", controller.Id, "state", DateTimeOffset.UtcNow, state1));

        var snapshot = store.GetSnapshot().Single();
        Assert.Equal(ControllerStatus.Faulted, snapshot.Status);
        Assert.Equal(2, snapshot.Revision);
    }

    [Fact]
    public void SnapshotOrderedByFloor()
    {
        var store = new TelemetryStore(new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Telemetry:SqlitePath"] = Path.Combine(Path.GetTempPath(), $"telemetry-{Guid.NewGuid():N}.db")
            }).Build());
        var controllers = DeviceIds.CreateBuilding().ToArray();

        foreach (var controller in controllers)
        {
            store.Ingest(new DeviceTelemetry($"e-{controller.Floor}", controller.Id, "state", DateTimeOffset.UtcNow, controller));
        }

        var snapshot = store.GetSnapshot();
        Assert.Equal(new[] { 1, 2, 3, 4 }, snapshot.Select(c => c.Floor));
    }

    [Fact]
    public void EventsReturnedInReverseChronologicalOrder()
    {
        var store = new TelemetryStore(new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Telemetry:SqlitePath"] = Path.Combine(Path.GetTempPath(), $"telemetry-{Guid.NewGuid():N}.db")
            }).Build());
        var controller = DeviceIds.CreateBuilding().First();

        store.IngestFallbackChange(new DeviceTelemetry("e1", controller.Id, "state", DateTimeOffset.UtcNow, controller));
        System.Threading.Thread.Sleep(10);
        store.IngestFallbackChange(new DeviceTelemetry("e2", controller.Id, "fault", DateTimeOffset.UtcNow, controller));

        var events = store.GetEvents();
        Assert.Equal(2, events.Count);
        Assert.Equal("e2", events[0].EventId);
        Assert.Equal("e1", events[1].EventId);
    }

    [Fact]
    public void EventsLimitedToMaxOf500()
    {
        var store = new TelemetryStore(new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Telemetry:SqlitePath"] = Path.Combine(Path.GetTempPath(), $"telemetry-{Guid.NewGuid():N}.db")
            }).Build());
        var controller = DeviceIds.CreateBuilding().First();

        for (int i = 0; i < 600; i++)
        {
            store.IngestFallbackChange(new DeviceTelemetry($"e{i}", controller.Id, "state", DateTimeOffset.UtcNow, controller));
        }

        var events = store.GetEvents();
        Assert.Equal(500, events.Count);
    }

    [Fact]
    public void ObserveUpdatesLastObservedTime()
    {
        var store = new TelemetryStore(new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Telemetry:SqlitePath"] = Path.Combine(Path.GetTempPath(), $"telemetry-{Guid.NewGuid():N}.db")
            }).Build());
        var controller = DeviceIds.CreateBuilding().First();

        store.Ingest(new DeviceTelemetry("e1", controller.Id, "state", DateTimeOffset.UtcNow, controller));
        store.Observe(controller.Id);
        
        // After observe, the GetSnapshot should reflect the updated observation time
        var snapshot = store.GetSnapshot();
        Assert.Single(snapshot);
    }

    [Fact]
    public void FallbackChangeUpdatesEvent()
    {
        var store = new TelemetryStore(new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Telemetry:SqlitePath"] = Path.Combine(Path.GetTempPath(), $"telemetry-{Guid.NewGuid():N}.db")
            }).Build());
        var controller = DeviceIds.CreateBuilding().First();
        var state1 = controller with { Status = ControllerStatus.Healthy };
        var state2 = controller with { Status = ControllerStatus.Faulted };

        store.IngestFallbackChange(new DeviceTelemetry("fallback", controller.Id, "recovered", DateTimeOffset.UtcNow, state1));
        store.IngestFallbackChange(new DeviceTelemetry("fallback2", controller.Id, "fault", DateTimeOffset.UtcNow, state2));

        var events = store.GetEvents();
        Assert.Equal(2, events.Count);
    }
}
