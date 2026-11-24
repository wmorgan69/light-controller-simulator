using Devices.Contracts;

public static class MqttCommandRouting
{
    public static bool IsValid(string? topic, DeviceCommand command)
    {
        var parts = topic?.Split('/');
        return parts is { Length: 4 } &&
            parts[0] == "building" &&
            parts[1] == "controllers" &&
            parts[3] == "commands" &&
            IsTopicLevel(parts[2]) &&
            IsTopicLevel(command.CommandId) &&
            string.Equals(parts[2], command.ControllerId, StringComparison.Ordinal);
    }

    private static bool IsTopicLevel(string? value) =>
        !string.IsNullOrWhiteSpace(value) && value.Length <= 128 &&
        value.All(character => character is not ('/' or '+' or '#') && !char.IsControl(character));
}
