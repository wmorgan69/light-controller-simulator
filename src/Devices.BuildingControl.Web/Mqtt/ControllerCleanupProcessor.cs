public static class ControllerCleanupProcessor
{
    public static async Task ProcessAsync(BuildingDesignStore store, IBuildingDeviceConnector simulator,
        Func<string, CancellationToken, Task> clearRetained, ILogger logger, CancellationToken cancellationToken)
    {
        foreach (var item in store.ReadCleanup().Where(item =>
            item.Status is BuildingDesignCleanupStatus.Pending or BuildingDesignCleanupStatus.Failed))
        {
            var snapshot = simulator.GetControllerSnapshot();
            if (snapshot.Revision != item.ActiveRevision || snapshot.Controllers.Any(controller => controller.Id == item.ControllerId))
                continue;
            try
            {
                await clearRetained(item.ControllerId, cancellationToken);
                if (store.CompleteCleanup(item.ControllerId, item.ActiveRevision) != BuildingDesignStoreStatus.Success)
                    logger.LogWarning("Cleanup confirmation for controller {ControllerId} was superseded", item.ControllerId);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception exception)
            {
                logger.LogWarning(exception, "Could not clear retained MQTT state for controller {ControllerId}; cleanup will be retried", item.ControllerId);
                store.MarkCleanupFailed(item.ControllerId, item.ActiveRevision);
            }
        }
    }
}
