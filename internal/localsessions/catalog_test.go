package localsessions

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestNativeSources(t *testing.T) {
	home := t.TempDir()
	id := "12345678-abcd-1234-abcd-123456789012"
	write := func(path, data string) {
		t.Helper()
		path = filepath.Join(home, filepath.FromSlash(path))
		if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(data), 0600); err != nil {
			t.Fatal(err)
		}
	}
	claude := `{"type":"user","message":{"role":"user","content":"hello"}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"thinking","text":"private"},{"type":"text","text":"reply"}]}}`
	write(".claude/projects/work/"+id+".jsonl", claude)
	write(".claude/projects/work/memory.jsonl", claude)
	write(".claude/projects/work/"+id+"/subagents/"+id+".jsonl", claude)
	write(".claude/projects/work/extra.txt", "ignored")
	write(".cursor/projects/work/agent-transcripts/"+id+"/"+id+".jsonl", `{"role":"user","message":{"content":[{"type":"text","text":"hello"}]}}
{"role":"assistant","message":{"content":"reply"}}`)
	write(".workbuddy/projects/work/"+id+".jsonl", `{"type":"message","role":"user","content":"<system-reminder>private</system-reminder><user_query>hello</user_query>"}
{"type":"message","role":"assistant","content":"reply"}`)
	meta := `{"type":"session_meta","payload":{"cwd":"work","model_provider":"other"}}`
	codex := meta + "\n" + `{"type":"event_msg","payload":{"unused":"` + strings.Repeat("x", 2<<20) + `"}}
{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"hello"}]}}
{"type":"response_item","payload":{"type":"message","role":"assistant","content":"reply"}}`
	write(".codex/sessions/2026/11/20/rollout-123.jsonl", codex)
	write(".codex/sessions/2026/11/20/rollout-gateway.jsonl", strings.Replace(meta, "other", "aiseat", 1))
	_ = os.Symlink(filepath.Join(home, ".claude", "projects", "work"), filepath.Join(home, ".claude", "projects", "redirect"))
	c := New(home, "", "")
	sessions, issues := c.index()
	if len(sessions) != 4 || len(issues) != 0 {
		t.Fatalf("sessions=%d issues=%v", len(sessions), issues)
	}
	for _, s := range sessions {
		rec := httptest.NewRecorder()
		c.ServeHTTP(rec, httptest.NewRequest("GET", "/native/session?id="+s.ID, nil))
		var result struct{ Content string }
		if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
			t.Fatal(s.Agent, err, rec.Code)
		}
		if result.Content != "提问\nhello\n\n回复\nreply" {
			t.Fatalf("%s: unexpected content %q", s.Agent, result.Content)
		}
	}
	rec := httptest.NewRecorder()
	c.ServeHTTP(rec, httptest.NewRequest("GET", "/native/session?id=../config.json", nil))
	if rec.Code != 404 {
		t.Fatal("accepted arbitrary path")
	}
}
