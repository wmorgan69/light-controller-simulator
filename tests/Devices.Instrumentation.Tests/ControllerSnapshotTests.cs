using System.Net;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using Devices.Contracts;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;

public sealed class ControllerSnapshotTests : IDisposable
{
    private readonly string path = Path.GetFullPath($"snapshot-test-{Guid.NewGuid():N}.db");
    private readonly ControllerState[] controllers = DeviceIds.CreateBuilding().Take(2).ToArray();
    private TelemetryStore CreateStore() => new(new ConfigurationBuilder().AddInMemoryCollection(
        new Dictionary<string, string?> { ["Telemetry:SqlitePath"] = path }).Build());

    [Fact]
    public void RemovalIsDurableAndRejectsLateMessagesAndStaleSnapshots()
    {
        var store = CreateStore();
        store.Ingest(Event("original", controllers[1]));
        Assert.True(store.ApplySnapshot(new(4, controllers)));
        Assert.True(store.ApplySnapshot(new(5, [controllers[0]])));
        store.Ingest(Event("unknown", controllers[1] with { Id = "not-in-snapshot" }));
        store.Ingest(Event("late", controllers[1] with { Revision = 100 }));
        store.IngestFallbackChange(Event("late-http", controllers[1]));
        store.Observe(controllers[1].Id);
        Assert.Null(store.GetController(controllers[1].Id));
        Assert.Null(store.GetController("not-in-snapshot"));
        Assert.Contains(store.GetEvents(), e => e.EventId == "original");
        Assert.DoesNotContain(store.GetEvents(), e => e.EventId == "late" || e.EventId == "late-http");
        Assert.False(store.ApplySnapshot(new(4, controllers)));
        Assert.Equal(0L, CountRows("controller_latest", controllers[1].Id));
        Assert.Equal(0L, CountRows("controller_observed", controllers[1].Id));
        Assert.Equal(1L, CountRows("controller_tombstones", controllers[1].Id));

        var restarted = CreateStore();
        Assert.False(restarted.ApplySnapshot(new(4, controllers)));
        restarted.Ingest(Event("after-restart", controllers[1]));
        Assert.Null(restarted.GetController(controllers[1].Id));
        Assert.Contains(restarted.GetEvents(), e => e.EventId == "original");
        Assert.Throws<InvalidDataException>(() => restarted.ApplySnapshot(new(6, controllers)));
        Assert.True(restarted.ApplySnapshot(new(6, [controllers[0], controllers[1] with { Id = "new-controller", Rooms = [] }])));
        Assert.NotNull(restarted.GetController("new-controller"));
    }

    [Fact]
    public void SnapshotFailureRollsBackMembershipRemovalAndState()
    {
        var store = CreateStore();
        store.ApplySnapshot(new(1, controllers));
        using (var connection = Open())
        using (var command = connection.CreateCommand())
        {
            command.CommandText = """
                CREATE TRIGGER reject_snapshot BEFORE INSERT ON controller_tombstones
                BEGIN SELECT RAISE(ABORT, 'rejected'); END;
                """;
            command.ExecuteNonQuery();
        }
        Assert.Throws<SqliteException>(() => store.ApplySnapshot(new(2, [controllers[0]])));
        Assert.NotNull(store.GetController(controllers[1].Id));
        var restarted = CreateStore();
        Assert.NotNull(restarted.GetController(controllers[1].Id));
        Assert.True(restarted.ApplySnapshot(new(1, controllers)));
    }

    [Fact]
    public void SameRevisionRequiresSameMembershipAndRetainedUpdatesAcceptResetRevision()
    {
        var store = CreateStore();
        store.ApplySnapshot(new(10, [controllers[0] with { Revision = 100, Status = ControllerStatus.Faulted }]));
        Assert.Throws<InvalidDataException>(() => store.ApplySnapshot(new(10, [])));
        store.ApplySnapshot(new(10, [controllers[0] with { Revision = 1, Status = ControllerStatus.Healthy }]));
        Assert.Equal(1, store.GetController(controllers[0].Id)!.Revision);
        Assert.Equal(ControllerStatus.Healthy, store.GetController(controllers[0].Id)!.Status);
    }

    [Theory]
    [InlineData(false, "null-room")]
    [InlineData(false, "null-strip")]
    [InlineData(false, "room-name")]
    [InlineData(false, "room-controller")]
    [InlineData(false, "room-owner")]
    [InlineData(false, "strip-id")]
    [InlineData(false, "strip-room")]
    [InlineData(false, "strip-owner")]
    [InlineData(false, "null-fault")]
    [InlineData(false, "fault-scope")]
    [InlineData(false, "fault-description")]
    [InlineData(false, "invalid-status")]
    [InlineData(true, "null-room")]
    [InlineData(true, "null-strip")]
    [InlineData(true, "room-name")]
    [InlineData(true, "room-controller")]
    [InlineData(true, "room-owner")]
    [InlineData(true, "strip-id")]
    [InlineData(true, "strip-room")]
    [InlineData(true, "strip-owner")]
    [InlineData(true, "null-fault")]
    [InlineData(true, "fault-scope")]
    [InlineData(true, "fault-description")]
    [InlineData(true, "invalid-status")]
    public void InvalidNestedControllersAreRejectedAtomically(bool legacy, string mutation)
    {
        var store = CreateStore();
        store.ApplySnapshot(new(1, controllers));
        var room = controllers[0].Rooms[0];
        var strip = room.LightStrips[0];
        var fault = new ControllerFault("fault", "light", strip.Id, "Broken");
        var invalid = mutation switch
        {
            "null-room" => controllers[0] with { Rooms = [null!] },
            "null-strip" => controllers[0] with { Rooms = [room with { LightStrips = [null!] }] },
            "room-name" => controllers[0] with { Rooms = [room with { Name = null! }] },
            "room-controller" => controllers[0] with { Rooms = [room with { ControllerId = " " }] },
            "room-owner" => controllers[0] with { Rooms = [room with { ControllerId = "other-controller" }] },
            "strip-id" => controllers[0] with { Rooms = [room with { LightStrips = [strip with { Id = null! }] }] },
            "strip-room" => controllers[0] with { Rooms = [room with { LightStrips = [strip with { RoomId = "" }] }] },
            "strip-owner" => controllers[0] with { Rooms = [room with { LightStrips = [strip with { RoomId = "other-room" }] }] },
            "null-fault" => controllers[0] with { Faults = [null!] },
            "fault-scope" => controllers[0] with { Faults = [fault with { Scope = null! }] },
            "fault-description" => controllers[0] with { Faults = [fault with { Description = "" }] },
            "invalid-status" => controllers[0] with { Status = (ControllerStatus)99 },
            _ => throw new ArgumentOutOfRangeException(nameof(mutation))
        };
        var eventCount = store.GetEvents().Count;

        if (legacy)
            Assert.Throws<InvalidDataException>(() => store.ApplyLegacyControllers(
                [controllers[1] with { Revision = 100 }, invalid]));
        else
            Assert.Throws<InvalidDataException>(() => store.ApplySnapshot(new(2, [invalid])));

        var restarted = CreateStore();
        foreach (var current in new[] { store, restarted })
        {
            Assert.Equal(2, current.GetSnapshot().Count);
            Assert.Equal(controllers[1].Revision, current.GetController(controllers[1].Id)!.Revision);
            Assert.Equal(eventCount, current.GetEvents().Count);
            Assert.True(current.ApplySnapshot(new(1, controllers)));
        }
        Assert.Equal(0L, CountRows("controller_tombstones", controllers[1].Id));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task HttpRejectsOmittedRequiredNestedFieldsBeforeChangingState(bool legacy)
    {
        var store = CreateStore();
        store.ApplySnapshot(new(1, controllers));
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        var array = JsonSerializer.SerializeToNode(new[] { controllers[0] }, options)!.AsArray();
        array[0]!["rooms"]![0]!["lightStrips"]![0]!.AsObject().Remove("isOn");
        var json = legacy ? array.ToJsonString() :
            new JsonObject { ["revision"] = 2, ["controllers"] = array }.ToJsonString();
        using var http = new HttpClient(new Handler(request =>
            legacy && request.RequestUri!.AbsolutePath == "/api/controller-snapshot"
                ? Response(HttpStatusCode.NotFound, "")
                : Response(HttpStatusCode.OK, json))) { BaseAddress = new Uri("http://simulator") };
        var subscriber = new TelemetrySubscriber(NullLogger<TelemetrySubscriber>.Instance,
            new ConfigurationBuilder().Build(), store);

        await Assert.ThrowsAsync<JsonException>(() => subscriber.PollOnceAsync(http, CancellationToken.None));

        var restarted = CreateStore();
        Assert.Equal(2, restarted.GetSnapshot().Count);
        Assert.True(restarted.ApplySnapshot(new(1, controllers)));
        Assert.Equal(0L, CountRows("controller_tombstones", controllers[1].Id));
    }

    [Theory]
    [InlineData(false, false)]
    [InlineData(false, true)]
    [InlineData(true, false)]
    [InlineData(true, true)]
    public async Task HttpValidatesNestedValuesAndAllowsOptionalFields(bool legacy, bool malformed)
    {
        var store = CreateStore();
        store.ApplySnapshot(new(1, controllers));
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        var array = JsonSerializer.SerializeToNode(controllers, options)!.AsArray();
        array[0]!.AsObject().Remove("revision");
        array[0]!["rooms"]![0]!.AsObject().Remove("sensorId");
        if (malformed) array[0]!["rooms"]![0]!["lightStrips"]![0] = null;
        var json = legacy ? array.ToJsonString() :
            new JsonObject { ["revision"] = 1, ["controllers"] = array }.ToJsonString();
        using var http = new HttpClient(new Handler(request =>
            legacy && request.RequestUri!.AbsolutePath == "/api/controller-snapshot"
                ? Response(HttpStatusCode.NotFound, "")
                : Response(HttpStatusCode.OK, json))) { BaseAddress = new Uri("http://simulator") };
        var subscriber = new TelemetrySubscriber(NullLogger<TelemetrySubscriber>.Instance,
            new ConfigurationBuilder().Build(), store);

        if (malformed)
            await Assert.ThrowsAsync<InvalidDataException>(() => subscriber.PollOnceAsync(http, CancellationToken.None));
        else
            await subscriber.PollOnceAsync(http, CancellationToken.None);

        var restarted = CreateStore();
        Assert.Equal(2, restarted.GetSnapshot().Count);
        Assert.Null(restarted.GetController(controllers[0].Id)!.Rooms[0].SensorId);
        Assert.True(restarted.ApplySnapshot(new(1, controllers)));
    }

    [Theory]
    [InlineData(false, "null-strip")]
    [InlineData(false, "missing-field")]
    [InlineData(false, "invalid-json")]
    [InlineData(false, "room-owner")]
    [InlineData(false, "strip-owner")]
    [InlineData(true, "null-strip")]
    [InlineData(true, "missing-field")]
    [InlineData(true, "invalid-json")]
    [InlineData(true, "room-owner")]
    [InlineData(true, "strip-owner")]
    public void RestartSkipsMalformedRowsAndHttpCanRestoreLatest(bool legacy, string mutation)
    {
        var store = CreateStore();
        store.ApplySnapshot(new(1, controllers));
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        var state = JsonSerializer.SerializeToNode(controllers[0], options)!.AsObject();
        if (mutation == "null-strip")
            state["rooms"]![0]!["lightStrips"]![0] = null;
        if (mutation == "missing-field")
            state["rooms"]![0]!.AsObject().Remove("presence");
        if (mutation == "room-owner")
            state["rooms"]![0]!["controllerId"] = "other-controller";
        if (mutation == "strip-owner")
            state["rooms"]![0]!["lightStrips"]![0]!["roomId"] = "other-room";
        var badState = mutation == "invalid-json" ? "{" : state.ToJsonString();
        var existingEvent = store.GetEvents().Single(e => e.ControllerId == controllers[0].Id);
        var badEvent = JsonSerializer.SerializeToNode(existingEvent, options)!.AsObject();
        badEvent["state"] = mutation == "invalid-json" ? null : state.DeepClone();
        using (var connection = Open())
        using (var command = connection.CreateCommand())
        {
            command.CommandText = """
                UPDATE controller_latest SET payload = $state WHERE controller_id = $id;
                UPDATE telemetry_events SET payload = $event WHERE controller_id = $id;
                INSERT INTO telemetry_events (event_id, controller_id, event_type, timestamp, payload)
                VALUES ('broken-json', $id, 'state', '9999-01-01', '{');
                """;
            command.Parameters.AddWithValue("$state", badState);
            command.Parameters.AddWithValue("$event", badEvent.ToJsonString());
            command.Parameters.AddWithValue("$id", controllers[0].Id);
            command.ExecuteNonQuery();
        }
        var logger = new CaptureLogger();
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Telemetry:SqlitePath"] = path }).Build();

        var restarted = new TelemetryStore(configuration, logger);

        Assert.Null(restarted.GetController(controllers[0].Id));
        Assert.NotNull(restarted.GetController(controllers[1].Id));
        Assert.Single(restarted.GetEvents());
        Assert.True(logger.Warnings >= 3);
        Assert.Equal(1L, CountRows("controller_latest", controllers[0].Id));
        Assert.Equal(2L, CountRows("telemetry_events", controllers[0].Id));

        if (legacy)
            restarted.ApplyLegacyControllers(controllers);
        else
            Assert.True(restarted.ApplySnapshot(new(1, controllers)));
        Assert.NotNull(restarted.GetController(controllers[0].Id));
        Assert.NotNull(CreateStore().GetController(controllers[0].Id));
        Assert.Equal(3L, CountRows("telemetry_events", controllers[0].Id));
    }

    [Fact]
    public async Task PollFallsBackOnlyOn404AndLeavesStateOnFailures()
    {
        var store = CreateStore();
        var calls = new List<string>();
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        options.Converters.Add(new JsonStringEnumConverter());
        var mode = 0;
        using var http = new HttpClient(new Handler(request =>
        {
            calls.Add(request.RequestUri!.AbsolutePath);
            return (mode, request.RequestUri.AbsolutePath) switch
            {
                (0, "/api/controller-snapshot") => Response(HttpStatusCode.NotFound, ""),
                (0, "/api/controllers") => Response(HttpStatusCode.OK, JsonSerializer.Serialize(controllers, options)),
                (1, _) => Response(HttpStatusCode.InternalServerError, ""),
                (2, _) => Response(HttpStatusCode.OK, """{"controllers":[]}"""),
                (3, _) => Response(HttpStatusCode.OK, JsonSerializer.Serialize(new BuildingControllerSnapshot(1, [controllers[0]]), options)),
                (4, "/api/controller-snapshot") => Response(HttpStatusCode.NotFound, ""),
                (4, "/api/controllers") => Response(HttpStatusCode.ServiceUnavailable, ""),
                _ => throw new InvalidOperationException()
            };
        })) { BaseAddress = new Uri("http://simulator") };
        var subscriber = new TelemetrySubscriber(NullLogger<TelemetrySubscriber>.Instance,
            new ConfigurationBuilder().Build(), store);
        await subscriber.PollOnceAsync(http, CancellationToken.None);
        Assert.Equal(new[] { "/api/controller-snapshot", "/api/controllers" }, calls);
        Assert.Equal(2, store.GetSnapshot().Count);
        calls.Clear();
        mode = 1;
        await Assert.ThrowsAsync<HttpRequestException>(() => subscriber.PollOnceAsync(http, CancellationToken.None));
        Assert.Equal(new[] { "/api/controller-snapshot" }, calls);
        Assert.Equal(2, store.GetSnapshot().Count);
        calls.Clear();
        mode = 2;
        await Assert.ThrowsAsync<InvalidDataException>(() => subscriber.PollOnceAsync(http, CancellationToken.None));
        Assert.Equal(new[] { "/api/controller-snapshot" }, calls);
        Assert.Equal(2, store.GetSnapshot().Count);
        mode = 3;
        await subscriber.PollOnceAsync(http, CancellationToken.None);
        Assert.Null(store.GetController(controllers[1].Id));
        mode = 4;
        await Assert.ThrowsAsync<HttpRequestException>(() => subscriber.PollOnceAsync(http, CancellationToken.None));
        Assert.Single(store.GetSnapshot());
    }

    private static DeviceTelemetry Event(string id, ControllerState state) =>
        new(id, state.Id, "state.changed", DateTimeOffset.UtcNow, state);

    private static HttpResponseMessage Response(HttpStatusCode code, string content) =>
        new(code) { Content = new StringContent(content) };

    private long CountRows(string table, string id)
    {
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = $"SELECT COUNT(*) FROM {table} WHERE controller_id = $id";
        command.Parameters.AddWithValue("$id", id);
        return (long)command.ExecuteScalar()!;
    }

    private SqliteConnection Open()
    {
        var connection = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = path }.ToString());
        connection.Open();
        return connection;
    }

    public void Dispose()
    {
        SqliteConnection.ClearAllPools();
        File.Delete(path);
    }

    private sealed class Handler(Func<HttpRequestMessage, HttpResponseMessage> respond) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            Task.FromResult(respond(request));
    }

    private sealed class CaptureLogger : ILogger<TelemetryStore>
    {
        public int Warnings { get; private set; }
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel logLevel) => true;
        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception,
            Func<TState, Exception?, string> formatter)
        {
            if (logLevel == LogLevel.Warning) Warnings++;
        }
    }
}
