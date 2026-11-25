using Devices.Contracts;

public sealed record BuildingView(BuildingDesign? Design, IReadOnlyList<ControllerState> Controllers);
public sealed record FaultRequest(string Scope, string TargetId, string Description);

public enum SensorTriggerResult
{
    Triggered,
    RoomNotFound,
    SensorFaulted
}

public enum FaultMutationResult
{
    Added,
    ControllerNotFound,
    InvalidTarget,
    Duplicate
}

public interface IBuildingDeviceConnector
{
    IReadOnlyList<ControllerState> GetControllers();
    ControllerState? GetController(string controllerId);
    BuildingControllerSnapshot GetControllerSnapshot();
    BuildingView GetBuildingView();
    IReadOnlyList<ControllerState> ActivateDesign(BuildingDesign design, Action? commit = null);
}

public interface ISimulatedDeviceConnector : IBuildingDeviceConnector
{
    SensorTriggerResult TriggerSensor(string roomId, out ControllerState? controller);
    bool ResetSensor(string roomId, out ControllerState controller);
    FaultMutationResult AddFault(string deviceId, FaultRequest request, out ControllerState? controller);
    bool ClearFault(string deviceId, string faultId, out ControllerState controller);
    bool ClearFaultByTarget(string controllerId, string targetId, out ControllerState controller);
    SensorTriggerResult TriggerSensorForController(string controllerId, string roomId, out ControllerState? controller);
    bool ResetSensorForController(string controllerId, string roomId, out ControllerState controller);
    bool IsFaultTargetOwnedBy(string controllerId, FaultRequest request);
    IReadOnlyList<ControllerState> ResetBuilding();
    IReadOnlyList<ControllerState> SetRandomOccupancy();
}
