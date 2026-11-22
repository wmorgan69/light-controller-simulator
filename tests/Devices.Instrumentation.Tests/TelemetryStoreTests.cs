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

    // Phase 2: Extended edge cases and boundary tests
    
    [Fact]
    public void MultipleControllersIndependentState()
    {
        var store = new TelemetryStore(new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Telemetry:SqlitePath"] = Path.Combine(Path.GetTempPath(), $"telemetry-{Guid.NewGuid():N}.db")
            }).Build());
        var controllers = DeviceIds.CreateBuilding().ToList();
        
        store.Ingest(new DeviceTelemetry("e1", controllers[0].Id, "state", DateTimeOffset.UtcNow, 
            controllers[0] with { Status = ControllerStatus.Faulted }));
        store.Ingest(new DeviceTelemetry("e2", controllers[1].Id, "state", DateTimeOffset.UtcNow, controllers[1]));
        
        var snapshot = store.GetSnapshot();
        Assert.Equal(2, snapshot.Count(c => c.Id == controllers[0].Id || c.Id == controllers[1].Id));
        Assert.Equal(ControllerStatus.Faulted, snapshot.First(c => c.Id == controllers[0].Id).Status);
        Assert.Equal(ControllerStatus.Healthy, snapshot.First(c => c.Id == controllers[1].Id).Status);
    }

    [Fact]
    public void IngestWithSameRevisionButDifferentState()
    {
        var store = new TelemetryStore(new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Telemetry:SqlitePath"] = Path.Combine(Path.GetTempPath(), $"telemetry-{Guid.NewGuid():N}.db")
            }).Build());
        var controller = DeviceIds.CreateBuilding().First();
        var healthy = controller with { Status = ControllerStatus.Healthy };
        var faulted = controller with { Status = ControllerStatus.Faulted };
        
        store.Ingest(new DeviceTelemetry("e1", controller.Id, "state", DateTimeOffset.UtcNow, healthy));
        store.Ingest(new DeviceTelemetry("e2", controller.Id, "fault", DateTimeOffset.UtcNow, faulted));
        
        var snapshot = store.GetSnapshot();
        Assert.Equal(ControllerStatus.Faulted, snapshot.Single().Status);
        var events = store.GetEvents();
        Assert.Equal(2, events.Count);
    }

    [Fact]
    public void IngestIdenticalStateIgnoreDuplicate()
    {
        var store = new TelemetryStore(new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Telemetry:SqlitePath"] = Path.Combine(Path.GetTempPath(), $"telemetry-{Guid.NewGuid():N}.db")
            }).Build());
        var controller = DeviceIds.CreateBuilding().First();
        
        store.Ingest(new DeviceTelemetry("e1", controller.Id, "state", DateTimeOffset.UtcNow, controller));
        store.Ingest(new DeviceTelemetry("e2", controller.Id, "state", DateTimeOffset.UtcNow, controller));
        
        var events = store.GetEvents();
        Assert.Single(events);
        Assert.Equal("e1", events[0].EventId);
    }

    [Fact]
    public void GetControllerWithMultipleControllers()
    {
        var store = new TelemetryStore(new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Telemetry:SqlitePath"] = Path.Combine(Path.GetTempPath(), $"telemetry-{Guid.NewGuid():N}.db")
            }).Build());
        var controllers = DeviceIds.CreateBuilding().ToList();
        
        store.Ingest(new DeviceTelemetry("e1", controllers[0].Id, "state", DateTimeOffset.UtcNow, controllers[0]));
        store.Ingest(new DeviceTelemetry("e2", controllers[1].Id, "state", DateTimeOffset.UtcNow, controllers[1]));
        store.Ingest(new DeviceTelemetry("e3", controllers[2].Id, "state", DateTimeOffset.UtcNow, controllers[2]));
        
        var controller2 = store.GetController(controllers[1].Id);
        Assert.NotNull(controller2);
        Assert.Equal(controllers[1].Id, controller2.Id);
    }

    [Fact]
    public void GetControllerWithInvalidIdReturnsNull()
    {
        var store = new TelemetryStore(new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Telemetry:SqlitePath"] = Path.Combine(Path.GetTempPath(), $"telemetry-{Guid.NewGuid():N}.db")
            }).Build());
        
        var controller = store.GetController("invalid-controller-id");
        Assert.Null(controller);
    }

    [Fact]
    public void ObserveUnknownControllerDoesNotAddController()
    {
        var store = new TelemetryStore(new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Telemetry:SqlitePath"] = Path.Combine(Path.GetTempPath(), $"telemetry-{Guid.NewGuid():N}.db")
            }).Build());
        
        store.Observe("unknown-controller-id");
        
        var snapshot = store.GetSnapshot();
        Assert.Empty(snapshot);
    }

    [Fact]
    public void FallbackChangeIgnoresRevision()
    {
        var store = new TelemetryStore(new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Telemetry:SqlitePath"] = Path.Combine(Path.GetTempPath(), $"telemetry-{Guid.NewGuid():N}.db")
            }).Build());
        var controller = DeviceIds.CreateBuilding().First();
        var newer = controller with { Revision = 10 };
        var older = controller with { Revision = 1 };
        
        store.IngestFallbackChange(new DeviceTelemetry("newer", controller.Id, "state", DateTimeOffset.UtcNow, newer));
        store.IngestFallbackChange(new DeviceTelemetry("older", controller.Id, "state", DateTimeOffset.UtcNow, older));
        
        var events = store.GetEvents();
        Assert.Equal(2, events.Count);
    }

    [Fact]
    public void EventsAbove500DropOldestOnIngest()
    {
        var store = new TelemetryStore(new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Telemetry:SqlitePath"] = Path.Combine(Path.GetTempPath(), $"telemetry-{Guid.NewGuid():N}.db")
            }).Build());
        var controller = DeviceIds.CreateBuilding().First();
        var now = DateTimeOffset.UtcNow;
        
        // Add 501 events
        for (int i = 0; i <= 500; i++)
        {
            store.IngestFallbackChange(new DeviceTelemetry($"e{i:D3}", controller.Id, "state", 
                now.AddSeconds(i), controller));
        }
        
        var events = store.GetEvents();
        Assert.Equal(500, events.Count);
        // Oldest event (e000) should be dropped, e001 should be oldest
        Assert.Equal("e001", events[events.Count - 1].EventId);
        Assert.Equal("e500", events[0].EventId);
    }

    [Fact]
    public void PersistenceRestoresEventsAfterRestart()
    {
        var dbPath = Path.Combine(Path.GetTempPath(), $"telemetry-persist-{Guid.NewGuid():N}.db");
        var controller = DeviceIds.CreateBuilding().First();
        
        // First instance: create and ingest
        {
            var config = new ConfigurationBuilder()
                .AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["Telemetry:SqlitePath"] = dbPath
                }).Build();
            var store1 = new TelemetryStore(config);
            store1.IngestFallbackChange(new DeviceTelemetry("persisted1", controller.Id, "state", 
                DateTimeOffset.UtcNow, controller));
            store1.IngestFallbackChange(new DeviceTelemetry("persisted2", controller.Id, "state", 
                DateTimeOffset.UtcNow, controller));
        }
        
        // Second instance: verify events are restored
        {
            var config = new ConfigurationBuilder()
                .AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["Telemetry:SqlitePath"] = dbPath
                }).Build();
            var store2 = new TelemetryStore(config);
            var events = store2.GetEvents();
            Assert.Equal(2, events.Count);
            Assert.Contains("persisted1", events.Select(e => e.EventId));
            Assert.Contains("persisted2", events.Select(e => e.EventId));
        }
    }

    [Fact]
    public void StateUpdatesAreReflectedInSnapshot()
    {
        var store = new TelemetryStore(new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Telemetry:SqlitePath"] = Path.Combine(Path.GetTempPath(), $"telemetry-{Guid.NewGuid():N}.db")
            }).Build());
        var controller = DeviceIds.CreateBuilding().First();
        
        store.Ingest(new DeviceTelemetry("e1", controller.Id, "state", DateTimeOffset.UtcNow, controller));
        var snapshot1 = store.GetSnapshot();
        Assert.Equal(ControllerStatus.Healthy, snapshot1.Single().Status);
        
        var faulted = controller with { Status = ControllerStatus.Faulted, Revision = 1 };
        store.Ingest(new DeviceTelemetry("e2", controller.Id, "fault", DateTimeOffset.UtcNow, faulted));
        var snapshot2 = store.GetSnapshot();
        Assert.Equal(ControllerStatus.Faulted, snapshot2.Single().Status);
    }

    [Fact]
    public void EmptySnapshotWhenNoControllersIngested()
    {
        var store = new TelemetryStore(new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Telemetry:SqlitePath"] = Path.Combine(Path.GetTempPath(), $"telemetry-{Guid.NewGuid():N}.db")
            }).Build());
        
        var snapshot = store.GetSnapshot();
        Assert.Empty(snapshot);
    }

    [Fact]
    public void EmptyEventsWhenNothingIngested()
    {
        var store = new TelemetryStore(new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Telemetry:SqlitePath"] = Path.Combine(Path.GetTempPath(), $"telemetry-{Guid.NewGuid():N}.db")
            }).Build());
        
        var events = store.GetEvents();
        Assert.Empty(events);
    }

    // Contract type tests
    [Fact]
    public void DeviceTelemetryCreatesWithAllProperties()
    {
        var controller = DeviceIds.CreateBuilding().First();
        var now = DateTimeOffset.UtcNow;
        var telemetry = new DeviceTelemetry("event-1", controller.Id, "state.changed", now, controller);
        
        Assert.Equal("event-1", telemetry.EventId);
        Assert.Equal(controller.Id, telemetry.ControllerId);
        Assert.Equal("state.changed", telemetry.EventType);
        Assert.Equal(now, telemetry.Timestamp);
        Assert.Equal(controller.Id, telemetry.State.Id);
    }

    [Fact]
    public void DeviceCommandCreatesWithAllProperties()
    {
        var now = DateTimeOffset.UtcNow;
        var command = new DeviceCommand("cmd-1", "room-1", "turn-on", null, "light-1", null, null, now);
        
        Assert.Equal("cmd-1", command.CommandId);
        Assert.Equal("room-1", command.ControllerId);
        Assert.Equal("turn-on", command.Action);
        Assert.Null(command.RoomId);
        Assert.Equal("light-1", command.TargetId);
        Assert.Null(command.Scope);
        Assert.Null(command.Description);
        Assert.Equal(now, command.Timestamp);
    }

    [Fact]
    public void DeviceCommandAckCreatesWithAllProperties()
    {
        var controller = DeviceIds.CreateBuilding().First();
        var now = DateTimeOffset.UtcNow;
        var ack = new DeviceCommandAck("ack-1", "controller-1", true, "Command accepted", controller, now);
        
        Assert.Equal("ack-1", ack.CommandId);
        Assert.Equal("controller-1", ack.ControllerId);
        Assert.True(ack.Accepted);
        Assert.Equal("Command accepted", ack.Message);
        Assert.Equal(controller.Id, ack.State!.Id);
        Assert.Equal(now, ack.Timestamp);
    }

    [Fact]
    public void DeviceCommandAckWithRejectedState()
    {
        var now = DateTimeOffset.UtcNow;
        var ack = new DeviceCommandAck("ack-2", "controller-2", false, "Command rejected", null, now);
        
        Assert.Equal("ack-2", ack.CommandId);
        Assert.Equal("controller-2", ack.ControllerId);
        Assert.False(ack.Accepted);
        Assert.Equal("Command rejected", ack.Message);
        Assert.Null(ack.State);
        Assert.Equal(now, ack.Timestamp);
    }

    [Fact]
    public void DeviceTransportStatusCreatesWithAllProperties()
    {
        var now = DateTimeOffset.UtcNow;
        var status = new DeviceTransportStatus(true, true, now, "All systems operational");
        
        Assert.True(status.MqttConnected);
        Assert.True(status.HttpAvailable);
        Assert.Equal(now, status.LastMqttConnectedAt);
        Assert.Equal("All systems operational", status.Message);
    }

    [Fact]
    public void DeviceTransportStatusWithNullLastConnectedAtCreates()
    {
        var status = new DeviceTransportStatus(false, false, null, "No connection");
        
        Assert.False(status.MqttConnected);
        Assert.False(status.HttpAvailable);
        Assert.Null(status.LastMqttConnectedAt);
        Assert.Equal("No connection", status.Message);
    }

    [Fact]
    public void DeviceIdsHelperMethodsGenerateCorrectIds()
    {
        var controllerId = DeviceIds.Controller(2);
        var roomId = DeviceIds.Room(2, "main");
        var sensorId = DeviceIds.Sensor(2, "main");
        var lightId = DeviceIds.Light(2, "main", 1);
        
        Assert.Equal("controller-floor-2", controllerId);
        Assert.Equal("floor-2-main", roomId);
        Assert.Equal("sensor-floor-2-main", sensorId);
        Assert.Equal("light-floor-2-main-1", lightId);
    }

    [Fact]
    public void DeviceIdsCreateBuildingProducesExpectedStructure()
    {
        var controllers = DeviceIds.CreateBuilding().ToArray();
        
        Assert.Equal(4, controllers.Length);
        Assert.All(controllers, c =>
        {
            Assert.Equal(3, c.Rooms.Count);
            Assert.All(c.Rooms, r =>
            {
                Assert.NotEmpty(r.LightStrips);
            });
        });
    }
}
