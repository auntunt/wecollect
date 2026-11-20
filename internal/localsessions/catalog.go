// Package localsessions reads supported native transcripts from the current user's profile.
package localsessions

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
)

type source struct {
	agent, base string
	patterns    []string
}

type Session struct {
	ID             string `json:"id"`
	Agent          string `json:"agent"`
	Group          string `json:"group"`
	Title          string `json:"title"`
	Modified       int64  `json:"modified"`
	Version        string `json:"version"`
	base, relative string
}

type Catalog struct {
	sources []source
	mu      sync.RWMutex
	files   map[string]Session
}

func New(home, codexHome, claudeConfig string) *Catalog {
	if codexHome == "" || !filepath.IsAbs(codexHome) {
		codexHome = filepath.Join(home, ".codex")
	}
	if claudeConfig == "" || !filepath.IsAbs(claudeConfig) {
		claudeConfig = filepath.Join(home, ".claude")
	}
	return &Catalog{sources: []source{
		{"Claude Code", filepath.Join(claudeConfig, "projects"), []string{"*/*.jsonl"}},
		{"Codex", filepath.Join(codexHome, "sessions"), []string{"[0-9][0-9][0-9][0-9]/[0-9][0-9]/[0-9][0-9]/rollout-*.jsonl"}},
		{"Cursor", filepath.Join(home, ".cursor", "projects"), []string{"*/agent-transcripts/*/*.jsonl", "*/agent-transcripts/*.jsonl"}},
		{"WorkBuddy", filepath.Join(home, ".workbuddy", "projects"), []string{"*/*.jsonl"}},
	}}
}

var uuidFile = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$`)

// Reject redirected profiles or entries, and keep the final open constrained to the source root.
func openRoot(base string) (*os.Root, error) {
	// macOS aliases /var and /tmp, so check the application-owned directory and its container.
	for _, path := range []string{filepath.Dir(base), base} {
		info, err := os.Lstat(path)
		if err != nil {
			return nil, err
		}
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return nil, errors.New("会话目录不是普通目录")
		}
	}
	return os.OpenRoot(base)
}

func openSession(root *os.Root, rel string) (*os.File, error) {
	path := ""
	for _, part := range strings.Split(rel, string(filepath.Separator)) {
		path = filepath.Join(path, part)
		info, err := root.Lstat(path)
		if err != nil {
			return nil, err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return nil, errors.New("跳过链接")
		}
		if path == rel && !info.Mode().IsRegular() {
			return nil, errors.New("跳过非常规文件")
		}
	}
	return root.Open(rel)
}

func discover(root *os.Root, pattern string, visit func(string, os.FileInfo) error) error {
	var walk func(string, []string) error
	walk = func(dir string, parts []string) error {
		f, err := root.Open(dir)
		if err != nil {
			return err
		}
		entries, err := f.ReadDir(-1)
		f.Close()
		if err != nil {
			return err
		}
		for _, e := range entries {
			if strings.HasPrefix(e.Name(), ".") || e.Type()&os.ModeSymlink != 0 {
				continue
			}
			matches, _ := filepath.Match(parts[0], e.Name())
			if !matches {
				continue
			}
			path := filepath.Join(dir, e.Name())
			if len(parts) > 1 {
				if e.IsDir() {
					if err = walk(path, parts[1:]); err != nil && !errors.Is(err, os.ErrNotExist) {
						return err
					}
				}
			} else if e.Type().IsRegular() {
				info, err := e.Info()
				if errors.Is(err, os.ErrNotExist) {
					continue
				}
				if err != nil {
					return err
				}
				if err = visit(path, info); err != nil {
					return err
				}
			}
		}
		return nil
	}
	return walk(".", strings.Split(pattern, "/"))
}

func codexGroup(root *os.Root, rel string) (string, error) {
	f, err := openSession(root, rel)
	if err != nil {
		return "", err
	}
	defer f.Close()
	var meta struct {
		Type    string
		Payload struct {
			Cwd      string
			Provider string `json:"model_provider"`
		}
	}
	if err = json.NewDecoder(f).Decode(&meta); err != nil {
		return "", err
	}
	if meta.Type != "session_meta" || meta.Payload.Cwd == "" {
		return "", errors.New("无法识别项目")
	}
	if meta.Payload.Provider == "aiseat" {
		return "", nil
	}
	return meta.Payload.Cwd, nil
}

func (c *Catalog) index() ([]Session, []string) {
	// Serialize refreshes so an older index cannot overwrite a newer one.
	c.mu.Lock()
	defer c.mu.Unlock()
	next := map[string]Session{}
	result := []Session{}
	issues := []string{}
	for _, s := range c.sources {
		root, err := openRoot(s.base)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			issues = append(issues, s.agent+"：无法访问本机会话目录")
			continue
		}
		failed := 0
		for _, pattern := range s.patterns {
			err = discover(root, pattern, func(rel string, info os.FileInfo) error {
				name := filepath.Base(rel)
				if s.agent != "Codex" && !uuidFile.MatchString(name) {
					return nil
				}
				digest := sha256.Sum256([]byte(s.agent + "\x00" + rel))
				id := hex.EncodeToString(digest[:])
				version := fmt.Sprintf("%d-%d", info.ModTime().UnixNano(), info.Size())
				group := strings.Split(rel, string(filepath.Separator))[0]
				if s.agent == "Codex" {
					if old, ok := c.files[id]; ok && old.Version == version {
						group = old.Group
					} else {
						var err error
						group, err = codexGroup(root, rel)
						if err != nil {
							failed++
							return nil
						}
					}
					if group == "" {
						return nil
					}
				}
				session := Session{id, s.agent, group, strings.TrimSuffix(name, ".jsonl"), info.ModTime().UnixMilli(), version, s.base, rel}
				next[id] = session
				result = append(result, session)
				return nil
			})
			if err != nil {
				issues = append(issues, s.agent+"：部分目录读取失败")
			}
		}
		if failed > 0 {
			issues = append(issues, fmt.Sprintf("%s：%d 份会话元数据无法读取", s.agent, failed))
		}
		root.Close()
	}
	c.files = next
	sort.Slice(result, func(i, j int) bool { return result[i].Modified > result[j].Modified })
	return result, issues
}

func (c *Catalog) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	if r.URL.Path == "/native/index" {
		list, issues := c.index()
		json.NewEncoder(w).Encode(map[string]any{"sessions": list, "issues": issues})
		return
	}
	if r.URL.Path != "/native/session" {
		http.NotFound(w, r)
		return
	}
	c.mu.RLock()
	s, ok := c.files[r.URL.Query().Get("id")]
	c.mu.RUnlock()
	if !ok {
		http.Error(w, "会话已移除", 404)
		return
	}
	root, err := openRoot(s.base)
	if err != nil {
		http.Error(w, "会话目录不可用", 409)
		return
	}
	defer root.Close()
	f, err := openSession(root, s.relative)
	if err != nil {
		http.Error(w, "会话不可读", 409)
		return
	}
	defer f.Close()
	content, err := readTranscript(f, s.Agent)
	if err != nil {
		http.Error(w, err.Error(), 422)
		return
	}
	json.NewEncoder(w).Encode(map[string]string{"content": content})
}

type message struct {
	Type     string
	Role     string
	Content  json.RawMessage
	Provider string `json:"model_provider"`
}

var userQuery = regexp.MustCompile(`(?s)<user_query>(.*?)</user_query>`)

func textOf(m message) string {
	var single string
	if json.Unmarshal(m.Content, &single) == nil {
		return single
	}
	var blocks []struct{ Type, Text string }
	if json.Unmarshal(m.Content, &blocks) != nil {
		return ""
	}
	var parts []string
	for _, b := range blocks {
		switch b.Type {
		case "text", "input_text", "output_text":
			if strings.TrimSpace(b.Text) != "" {
				parts = append(parts, b.Text)
			}
		}
	}
	return strings.Join(parts, "\n")
}

func readTranscript(f io.Reader, agent string) (string, error) {
	reader := bufio.NewReader(f)
	var lines []string
	for {
		line, err := reader.ReadBytes('\n')
		if len(strings.TrimSpace(string(line))) != 0 {
			var row struct {
				message
				Body    message `json:"message"`
				Payload message
				IsMeta  bool
			}
			if json.Unmarshal(line, &row) != nil {
				return "", errors.New("会话行尚未写完或格式有误，稍后重试")
			}
			var m message
			switch agent {
			case "Codex":
				if row.Type == "session_meta" && row.Payload.Provider == "aiseat" {
					return "", errors.New("公司网关会话已跳过")
				}
				if row.Type == "response_item" && row.Payload.Type == "message" {
					m = row.Payload
				}
			case "Claude Code":
				if !row.IsMeta && (row.Type == "user" || row.Type == "assistant") {
					m = row.Body
				}
			case "Cursor":
				m = row.Body
				m.Role = row.Role
			case "WorkBuddy":
				if row.Type == "message" {
					m = row.message
				}
			}
			if m.Role == "user" || m.Role == "assistant" {
				text := textOf(m)
				if agent == "WorkBuddy" && m.Role == "user" {
					var parts []string
					for _, match := range userQuery.FindAllStringSubmatch(text, -1) {
						parts = append(parts, match[1])
					}
					text = strings.Join(parts, "\n")
				}
				if strings.TrimSpace(text) != "" {
					role := "提问"
					if m.Role == "assistant" {
						role = "回复"
					}
					lines = append(lines, role+"\n"+text)
				}
			}
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			return "", errors.New("读取会话失败")
		}
	}
	if len(lines) == 0 {
		return "", errors.New("尚无可识别的提问或回复")
	}
	return strings.Join(lines, "\n\n"), nil
}
