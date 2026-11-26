using System.Text.Json;
using System.Text.Json.Nodes;
using Devices.Contracts;
using Microsoft.Extensions.Logging.Abstractions;

[Collection(TelemetryDatabaseCollection.Name)]
public sealed class TelemetryMessageTests
{
    private readonly TelemetryStore store;
    private readonly TelemetrySubscriber subscriber;
    private readonly ControllerState controller = DeviceIds.CreateBuilding().First();

    public TelemetryMessageTests()
    {
        TelemetryTestDatabase.Reset();
        var configuration = TelemetryTestDatabase.Configuration();
        store = new TelemetryStore(configuration);
        subscriber = new TelemetrySubscriber(NullLogger<TelemetrySubscriber>.Instance, configuration, store);
    }

    [Theory]
    [InlineData("http://user:password@localhost:5197/private?token=secret#fragment", "http://localhost:5197")]
    [InlineData("https://example.test:8443/path", "https://example.test:8443")]
    [InlineData("not a url", null)]
    [InlineData("file:///private", null)]
    public void StatusReportsOnlySafeHttpSourceOrigin(string baseUrl, string? expected)
    {
        var configuration = TelemetryTestDatabase.Configuration(
            new Dictionary<string, string?> { ["Telemetry:SimulatorBaseUrl"] = baseUrl });
        var instance = new TelemetrySubscriber(NullLogger<TelemetrySubscriber>.Instance, configuration, store);
        Assert.Equal(expected, instance.Status.SimulatorHttpSource);
    }

    [Fact]
    public void StatusIncludesDefaultHttpSourceAlongsideExistingTransportFields()
    {
        using var json = JsonDocument.Parse(JsonSerializer.Serialize(subscriber.Status, JsonSerializerOptions.Web));
        var status = json.RootElement;
        Assert.Equal("http://localhost:5080", status.GetProperty("simulatorHttpSource").GetString());
        Assert.False(status.GetProperty("mqttConnected").GetBoolean());
        Assert.False(status.GetProperty("httpAvailable").GetBoolean());
        Assert.Equal(JsonValueKind.Null, status.GetProperty("lastMqttConnectedAt").ValueKind);
        Assert.False(string.IsNullOrEmpty(status.GetProperty("message").GetString()));
    }

    [Fact]
    public void MatchingTopicAndPayloadAreIngested()
    {
        subscriber.ProcessTelemetryMessage($"building/controllers/{controller.Id}/telemetry", Payload(controller.Id, controller));

        Assert.Equal(controller.Id, store.GetController(controller.Id)!.Id);
        Assert.Equal("event", Assert.Single(store.GetEvents()).EventId);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("building/controllers//telemetry")]
    [InlineData("building/controllers/ /telemetry")]
    [InlineData("building/controllers/+/telemetry")]
    [InlineData("building/controllers/#/telemetry")]
    [InlineData("building/controllers/controller-floor-1/telemetry/extra")]
    [InlineData("building/controllers/controller-floor-1")]
    [InlineData("other/controllers/controller-floor-1/telemetry")]
    [InlineData("/building/controllers/controller-floor-1/telemetry")]
    [InlineData("building/controllers/other/telemetry")]
    [InlineData("building/controllers/CONTROLLER-FLOOR-1/telemetry")]
    public void InvalidOrMismatchedTopicIsRejected(string? topic)
    {
        subscriber.ProcessTelemetryMessage(topic, Payload(controller.Id, controller));

        Assert.Empty(store.GetSnapshot());
        Assert.Empty(store.GetEvents());
    }

    [Fact]
    public void InvalidOrMismatchedPayloadIdsAndMalformedPayloadAreRejected()
    {
        var topic = $"building/controllers/{controller.Id}/telemetry";
        subscriber.ProcessTelemetryMessage(topic, Payload("other", controller));
        subscriber.ProcessTelemetryMessage(topic, Payload(controller.Id, controller with { Id = "other" }));
        subscriber.ProcessTelemetryMessage(topic, Payload("", controller));
        subscriber.ProcessTelemetryMessage(topic, Payload(null, controller));
        subscriber.ProcessTelemetryMessage(topic, Payload(controller.Id, controller with { Id = "" }));
        subscriber.ProcessTelemetryMessage(topic, Payload(controller.Id, controller with { Id = null! }));
        subscriber.ProcessTelemetryMessage(topic, Payload(controller.Id, null));
        subscriber.ProcessTelemetryMessage(topic, "null");
        subscriber.ProcessTelemetryMessage(topic, "{");

        Assert.Empty(store.GetSnapshot());
        Assert.Empty(store.GetEvents());
        var restarted = new TelemetryStore(TelemetryTestDatabase.Configuration());
        Assert.Empty(restarted.GetSnapshot());
    }

    [Theory]
    [InlineData("rooms-null")]
    [InlineData("rooms-missing")]
    [InlineData("floor-missing")]
    [InlineData("last-seen-missing")]
    [InlineData("room-null")]
    [InlineData("room-id-null")]
    [InlineData("room-name-missing")]
    [InlineData("room-controller-blank")]
    [InlineData("room-controller-mismatch")]
    [InlineData("room-presence-missing")]
    [InlineData("room-sensor-triggered-missing")]
    [InlineData("strips-null")]
    [InlineData("strip-null")]
    [InlineData("strip-id-null")]
    [InlineData("strip-room-missing")]
    [InlineData("strip-room-mismatch")]
    [InlineData("strip-on-missing")]
    [InlineData("strip-faulted-missing")]
    [InlineData("faults-null")]
    [InlineData("fault-null")]
    [InlineData("fault-id-null")]
    [InlineData("fault-scope-missing")]
    [InlineData("fault-target-blank")]
    [InlineData("fault-description-null")]
    [InlineData("event-id-null")]
    [InlineData("event-type-missing")]
    [InlineData("timestamp-missing")]
    [InlineData("status-missing")]
    [InlineData("status-invalid")]
    public void MalformedStateDoesNotReplaceOrPersistValidState(string mutation)
    {
        var state = controller with { Faults = [new ControllerFault("fault", "light", "light", "Broken")] };
        var topic = $"building/controllers/{controller.Id}/telemetry";
        subscriber.ProcessTelemetryMessage(topic, Payload(controller.Id, state));
        var json = JsonNode.Parse(Payload(controller.Id, state with { Revision = state.Revision + 1 }))!.AsObject();
        var stateNode = json["State"]!.AsObject();
        var room = stateNode["Rooms"]![0]!.AsObject();
        var strip = room["LightStrips"]![0]!.AsObject();
        var fault = stateNode["Faults"]![0]!.AsObject();
        switch (mutation)
        {
            case "rooms-null": stateNode["Rooms"] = null; break;
            case "rooms-missing": stateNode.Remove("Rooms"); break;
            case "floor-missing": stateNode.Remove("Floor"); break;
            case "last-seen-missing": stateNode.Remove("LastSeen"); break;
            case "room-null": stateNode["Rooms"]![0] = null; break;
            case "room-id-null": room["Id"] = null; break;
            case "room-name-missing": room.Remove("Name"); break;
            case "room-controller-blank": room["ControllerId"] = " "; break;
            case "room-controller-mismatch": room["ControllerId"] = "other-controller"; break;
            case "room-presence-missing": room.Remove("Presence"); break;
            case "room-sensor-triggered-missing": room.Remove("SensorTriggered"); break;
            case "strips-null": room["LightStrips"] = null; break;
            case "strip-null": room["LightStrips"]![0] = null; break;
            case "strip-id-null": strip["Id"] = null; break;
            case "strip-room-missing": strip.Remove("RoomId"); break;
            case "strip-room-mismatch": strip["RoomId"] = "other-room"; break;
            case "strip-on-missing": strip.Remove("IsOn"); break;
            case "strip-faulted-missing": strip.Remove("IsFaulted"); break;
            case "faults-null": stateNode["Faults"] = null; break;
            case "fault-null": stateNode["Faults"]![0] = null; break;
            case "fault-id-null": fault["Id"] = null; break;
            case "fault-scope-missing": fault.Remove("Scope"); break;
            case "fault-target-blank": fault["TargetId"] = " "; break;
            case "fault-description-null": fault["Description"] = null; break;
            case "event-id-null": json["EventId"] = null; break;
            case "event-type-missing": json.Remove("EventType"); break;
            case "timestamp-missing": json.Remove("Timestamp"); break;
            case "status-missing": stateNode.Remove("Status"); break;
            case "status-invalid": stateNode["Status"] = 99; break;
            default: throw new ArgumentOutOfRangeException(nameof(mutation));
        }

        subscriber.ProcessTelemetryMessage(topic, json.ToJsonString());

        Assert.Equal(state.Revision, store.GetController(controller.Id)!.Revision);
        Assert.Single(store.GetEvents());
        var restarted = new TelemetryStore(TelemetryTestDatabase.Configuration());
        Assert.Equal(state.Revision, restarted.GetController(controller.Id)!.Revision);
        Assert.Single(restarted.GetEvents());
    }

    [Fact]
    public void EmptyCollectionsAndOptionalFieldsAreAccepted()
    {
        var state = controller with { Rooms = [], Faults = [] };
        var json = JsonNode.Parse(Payload(controller.Id, state))!.AsObject();
        json["State"]!.AsObject().Remove("Revision");
        subscriber.ProcessTelemetryMessage($"building/controllers/{controller.Id}/telemetry", json.ToJsonString());

        Assert.Empty(store.GetController(controller.Id)!.Rooms);
        Assert.Single(store.GetEvents());
    }

    [Fact]
    public void OptionalRoomSensorIdMayBeOmitted()
    {
        var json = JsonNode.Parse(Payload(controller.Id, controller))!.AsObject();
        foreach (var room in json["State"]!["Rooms"]!.AsArray())
            room!.AsObject().Remove("SensorId");
        subscriber.ProcessTelemetryMessage($"building/controllers/{controller.Id}/telemetry", json.ToJsonString());

        Assert.All(store.GetController(controller.Id)!.Rooms, room => Assert.Null(room.SensorId));
        Assert.Single(store.GetEvents());
    }

    private static string Payload(string? controllerId, ControllerState? state) =>
        JsonSerializer.Serialize(new DeviceTelemetry("event", controllerId!, "state.changed", DateTimeOffset.UtcNow, state!));

}
