package backend

import "testing"

func TestStatusConfigDisplayName(t *testing.T) {
	cfg := StatusConfig{Stage1Name: "Pending", Stage2Name: "Working", Stage3Name: "", Stage4Name: "Deploy"}
	tests := map[IssueStatus]string{
		StatusTodo:   "Todo",
		StatusStage1: "Pending",
		StatusStage2: "Working",
		StatusStage3: "Stage3", // hidden column
		StatusStage4: "Deploy",
		StatusDone:   "Done",
	}
	for status, want := range tests {
		if got := cfg.DisplayName(status); got != want {
			t.Errorf("DisplayName(%s) = %q, want %q", status, got, want)
		}
	}
}
