namespace Devices.Contracts;

public sealed class MqttCredentials
{
    private MqttCredentials(string username, string password)
    {
        Username = username;
        Password = password;
    }

    public string Username { get; }
    public string Password { get; }

    public static MqttCredentials? FromConfiguration(string? username, string? password)
    {
        if (username is null && password is null) return null;
        if (string.IsNullOrWhiteSpace(username) || string.IsNullOrWhiteSpace(password))
            throw new InvalidOperationException("MQTT username and password must both be configured.");
        return new(username, password);
    }
}
