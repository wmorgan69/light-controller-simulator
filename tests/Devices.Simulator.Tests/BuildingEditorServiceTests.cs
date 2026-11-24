using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Data.Sqlite;
using System.Text.Json;

public sealed class BuildingEditorServiceTests : IDisposable
{
    private readonly string path = Path.GetFullPath($"building-editor-{Guid.NewGuid():N}.db");

    [Fact]
    public void SaveActivatesPersistedDesignAndRestartRestoresIt()
    {
        var (editor, simulator) = Create();
        var state = editor.Read();
        var changed = state.Design with { Width = 25 };
        var response = editor.Save(new BuildingEditorWriteRequest(state.EditRevision, changed));
        Assert.Equal(200, ((IStatusCodeHttpResult)response).StatusCode);
        var saved = Assert.IsType<BuildingEditorState>(((IValueHttpResult)response).Value);
        Assert.Equal("active", saved.ActivationStatus);
        Assert.Equal(25, saved.ActiveDesign.Width);
        Assert.Equal(saved.Design.Revision, simulator.GetControllerSnapshot().Revision);
        Assert.Equal(saved.Design.Revision, editor.ReadStatus().RunningRevision);
        Assert.Equal(0, editor.ReadStatus().PendingCleanup);

        var (restarted, restoredSimulator) = Create();
        Assert.Equal(saved.Design.Revision, restarted.Read().ActiveDesign.Revision);
        Assert.Equal(25, restoredSimulator.GetBuildingView().Design!.Width);
    }

    [Fact]
    public void StaleWriteDoesNotChangeDesign()
    {
        var (editor, _) = Create();
        var state = editor.Read();
        var saved = editor.Save(new BuildingEditorWriteRequest(state.EditRevision, state.Design));
        Assert.Equal(200, ((IStatusCodeHttpResult)saved).StatusCode);
        var stale = editor.Save(new BuildingEditorWriteRequest(state.EditRevision, state.Design));
        Assert.Equal(409, ((IStatusCodeHttpResult)stale).StatusCode);
        Assert.Equal(state.Design.Revision + 1, editor.Read().Design.Revision);
    }

    [Fact]
    public void InvalidPlaceableSaveReturnsExplicitValidationErrors()
    {
        var (editor, _) = Create();
        var state = editor.Read();
        var topFloor = state.Design.Floors[^1] with
        {
            Stairs = [new StairDesign("invalid-stair", 1, 1, 2, 2, "north")]
        };
        var invalid = state.Design with
        {
            Floors = [.. state.Design.Floors.SkipLast(1), topFloor]
        };

        var response = editor.Save(new BuildingEditorWriteRequest(state.EditRevision, invalid));
        Assert.Equal(400, ((IStatusCodeHttpResult)response).StatusCode);
        var body = JsonSerializer.SerializeToElement(((IValueHttpResult)response).Value,
            new JsonSerializerOptions(JsonSerializerDefaults.Web));
        Assert.Equal("The building design is invalid.", body.GetProperty("detail").GetString());
        var errors = body.GetProperty("errors").EnumerateArray().ToArray();
        Assert.Contains(errors, error => error.GetProperty("path").GetString() == "floors[3].stairs[0].direction");
        Assert.Contains(errors, error => error.GetProperty("path").GetString() == "floors[3].stairs[0]");
    }

    [Fact]
    public void RestartRestoresActiveDesignThenRetriesPendingSave()
    {
        var store = new BuildingDesignStore(path);
        var initial = store.Read();
        var pending = store.Save(initial.EditRevision, initial.Saved with { Width = 25 });
        Assert.Equal(BuildingDesignStoreStatus.Success, pending.Status);
        Assert.NotEqual(pending.Snapshot.Saved.Revision, pending.Snapshot.Active.Revision);

        var (editor, simulator) = Create();
        Assert.Equal("active", editor.Read().ActivationStatus);
        Assert.Equal(pending.Snapshot.Saved.Revision, simulator.GetControllerSnapshot().Revision);
        Assert.Equal(25, editor.Read().ActiveDesign.Width);
    }

    [Fact]
    public void FailedRestartActivationKeepsOldDesignAndCanBeRetried()
    {
        var store = new BuildingDesignStore(path);
        var initial = store.Read();
        var pending = store.Save(initial.EditRevision, initial.Saved with { Width = 25 });
        ExecuteSql("CREATE TRIGGER reject_activation BEFORE UPDATE OF active ON building_design BEGIN SELECT RAISE(ABORT, 'activation failed'); END;");

        var (editor, simulator) = Create();
        Assert.Equal("failed", editor.Read().ActivationStatus);
        Assert.Equal(initial.Active.Revision, simulator.GetControllerSnapshot().Revision);
        Assert.Equal(pending.Snapshot.Saved.Revision, editor.Read().Design.Revision);
        Assert.Equal("failed", editor.ReadStatus().ActivationStatus);
        Assert.Equal(initial.Active.Revision, editor.ReadStatus().RunningRevision);

        ExecuteSql("DROP TRIGGER reject_activation;");
        Assert.Equal(200, ((IStatusCodeHttpResult)editor.Retry()).StatusCode);
        Assert.Equal("active", editor.Read().ActivationStatus);
        Assert.Equal(pending.Snapshot.Saved.Revision, simulator.GetControllerSnapshot().Revision);
    }

    [Fact]
    public void CleanupRetryRequiresNoLease()
    {
        var (editor, _) = Create();
        Assert.Equal(202, ((IStatusCodeHttpResult)editor.RetryCleanup()).StatusCode);
    }

    private void ExecuteSql(string sql)
    {
        using var connection = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = path, Pooling = false }.ToString());
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = sql;
        command.ExecuteNonQuery();
    }

    private (BuildingEditorService Editor, BuildingSimulator Simulator) Create()
    {
        var store = new BuildingDesignStore(path);
        var simulator = new BuildingSimulator();
        var mqtt = new MqttTelemetryPublisher(NullLogger<MqttTelemetryPublisher>.Instance,
            new ConfigurationBuilder().Build(), simulator, store);
        return (new BuildingEditorService(store, simulator, mqtt, NullLogger<BuildingEditorService>.Instance), simulator);
    }

    public void Dispose()
    {
        File.Delete(path);
        File.Delete(path + "-wal");
        File.Delete(path + "-shm");
    }
}
