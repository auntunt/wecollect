// The desktop launcher changes ports on each start. Keep its startup choice
// in the current user's configuration directory, outside browser storage.
package main

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
)

type startupWorkspace struct {
	Agent string `json:"agent"`
	Group string `json:"group"`
}

func saveWorkspace(path string, data []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(path), ".startup-*")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	_, writeErr := f.Write(data)
	closeErr := f.Close()
	if err := errors.Join(writeErr, closeErr); err != nil {
		return err
	}
	return os.Rename(f.Name(), path)
}

func serveStartup(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	dir, err := os.UserConfigDir()
	if err != nil {
		http.Error(w, "无法定位用户设置", 500)
		return
	}
	path := filepath.Join(dir, "WeCollect", "startup.json")
	var scope *startupWorkspace
	switch r.Method {
	case http.MethodGet:
		data, err := os.ReadFile(path)
		if !errors.Is(err, os.ErrNotExist) && (err != nil || json.Unmarshal(data, &scope) != nil) {
			http.Error(w, "启动工作区设置读取失败", 500)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(scope)
	case http.MethodPut:
		data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 64<<10))
		if err != nil || json.Unmarshal(data, &scope) != nil || (scope != nil && (scope.Agent == "" || scope.Group == "")) {
			http.Error(w, "工作区设置无效", 400)
			return
		}
		if scope == nil {
			err = os.Remove(path)
			if errors.Is(err, os.ErrNotExist) {
				err = nil
			}
		} else {
			encoded, _ := json.Marshal(scope)
			err = saveWorkspace(path, encoded)
		}
		if err != nil {
			http.Error(w, "启动工作区设置保存失败", 500)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}
