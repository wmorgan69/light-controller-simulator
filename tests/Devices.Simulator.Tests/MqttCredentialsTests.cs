using Devices.Contracts;

public class MqttCredentialsTests
{
    [Fact]
    public void AllowsAnonymousOrFullyConfiguredCredentials()
    {
        Assert.Null(MqttCredentials.FromConfiguration(null, null));
        Assert.NotNull(MqttCredentials.FromConfiguration("control", "local-password"));
    }

    [Theory]
    [InlineData("control", null)]
    [InlineData(null, "local-password")]
    [InlineData("", "local-password")]
    [InlineData("control", " ")]
    public void RejectsIncompleteCredentials(string? username, string? password)
    {
        Assert.Throws<InvalidOperationException>(() => MqttCredentials.FromConfiguration(username, password));
    }
}
