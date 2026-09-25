import { useState } from "react";
import { Button } from "@mui/material";
import StopCircleRounded from "@mui/icons-material/StopCircleRounded";
import { api } from "./api";

/** Cancels the remote operation in progress; partial destination files are kept and reported. */
export function CancelOperationButton(): React.JSX.Element {
  const [requested, setRequested] = useState(false);
  return (
    <Button
      color="error"
      variant="outlined"
      startIcon={<StopCircleRounded />}
      disabled={requested}
      onClick={() => {
        setRequested(true);
        void api.cancelOperation();
      }}
    >
      {requested ? "Cancelling…" : "Cancel"}
    </Button>
  );
}
