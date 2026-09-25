import { useState } from "react";
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from "@mui/material";
import SkipNextRounded from "@mui/icons-material/SkipNextRounded";

type Props = {
  label: string;
  detail: string;
  onSkip(): void;
};

/** Skipping a step is explicit: it is confirmed here and recorded in the report. */
export function SkipStepButton({ label, detail, onSkip }: Props): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button color="inherit" startIcon={<SkipNextRounded />} onClick={() => setOpen(true)}>{label}</Button>
      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Skip this step?</DialogTitle>
        <DialogContent><Typography>{detail}</Typography></DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={() => { setOpen(false); onSkip(); }}>Skip</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
