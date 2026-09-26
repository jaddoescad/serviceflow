import React, { useState } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { registerRootComponent } from "expo";
import ProjectCameraScreen from "../src/components/ProjectCameraScreen";

function CameraHarnessApp() {
  const [queueItems, setQueueItems] = useState([]);

  return (
    <SafeAreaProvider>
      <ProjectCameraScreen
        visible
        projectName="Camera Preview Test"
        queueItems={queueItems}
        onCapture={(asset) => {
          setQueueItems((items) => [
            ...items,
            {
              localId: `${Date.now()}-${Math.random()}`,
              asset,
              kind: asset.type === "video" ? "video" : "image",
              status: "uploaded",
              attempts: 0,
            },
          ]);
        }}
      />
    </SafeAreaProvider>
  );
}

registerRootComponent(CameraHarnessApp);
