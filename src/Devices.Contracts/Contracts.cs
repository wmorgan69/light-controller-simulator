namespace Devices.Contracts;

public enum ControllerStatus
{
    Healthy,
    Faulted,
    Offline
}

public sealed record LightStrip(string Id, string RoomId, bool IsOn, bool IsFaulted);

public sealed record RoomState(string Id, string Name, string ControllerId, bool SensorTriggered, bool Presence, IReadOnlyList<LightStrip> LightStrips, string? SensorId = null);

public sealed record ControllerFault(string Id, string Scope, string TargetId, string Description);

public sealed record ControllerState(
    string Id,
    int Floor,
    ControllerStatus Status,
    DateTimeOffset LastSeen,
    IReadOnlyList<RoomState> Rooms,
    IReadOnlyList<ControllerFault> Faults,
    int Revision = 0);

public sealed record BuildingControllerSnapshot(long Revision, IReadOnlyList<ControllerState> Controllers);

public sealed record DeviceTelemetry(
    string EventId,
    string ControllerId,
    string EventType,
    DateTimeOffset Timestamp,
    ControllerState State);

public sealed record DeviceCommand(
    string CommandId,
    string ControllerId,
    string Action,
    string? RoomId,
    string? TargetId,
    string? Scope,
    string? Description,
    DateTimeOffset Timestamp);

public sealed record DeviceCommandAck(
    string CommandId,
    string ControllerId,
    bool Accepted,
    string Message,
    ControllerState? State,
    DateTimeOffset Timestamp);

public sealed record DeviceTransportStatus(
    bool MqttConnected,
    bool HttpAvailable,
    DateTimeOffset? LastMqttConnectedAt,
    string Message);
