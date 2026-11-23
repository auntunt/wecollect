// The local workspace uses a browser window. Company authentication is handled on the company origin.
package main

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sync/atomic"
	"time"

	"github.com/auntunt/wecollect/internal/localsessions"
	"github.com/auntunt/wecollect/internal/wecollectui"
)

func launch(url string) error {
	var candidates []string
	if runtime.GOOS == "darwin" {
		candidates = []string{"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"}
	} else if runtime.GOOS == "windows" {
		for _, root := range []string{os.Getenv("ProgramFiles(x86)"), os.Getenv("ProgramFiles"), os.Getenv("LOCALAPPDATA")} {
			if root != "" {
				candidates = append(candidates, filepath.Join(root, "Microsoft", "Edge", "Application", "msedge.exe"), filepath.Join(root, "Google", "Chrome", "Application", "chrome.exe"))
			}
		}
	}
	for _, p := range candidates {
		if _, err := os.Stat(p); err == nil {
			if err := exec.Command(p, "--app="+url).Start(); err == nil {
				return nil
			}
		}
	}
	if runtime.GOOS == "darwin" {
		return exec.Command("open", url).Start()
	}
	if runtime.GOOS == "windows" {
		return exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
	}
	return exec.Command("xdg-open", url).Start()
}
func main() {
	l, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		log.Fatal(err)
	}
	host := l.Addr().String()
	var secret [32]byte
	rand.Read(secret[:])
	key := hex.EncodeToString(secret[:])
	home, err := os.UserHomeDir()
	if err != nil {
		log.Fatal("无法定位当前用户目录")
	}
	catalog := localsessions.New(home, os.Getenv("CODEX_HOME"), os.Getenv("CLAUDE_CONFIG_DIR"))
	mux := http.NewServeMux()
	mux.HandleFunc("/native/", func(w http.ResponseWriter, r *http.Request) {
		if subtle.ConstantTimeCompare([]byte(r.Header.Get("X-WeCollect-Local")), []byte(key)) != 1 {
			http.Error(w, "无法访问本机记录", http.StatusForbidden)
			return
		}
		if r.URL.Path == "/native/startup" {
			serveStartup(w, r)
			return
		}
		if r.Method != http.MethodGet {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		catalog.ServeHTTP(w, r)
	})
	mux.Handle("/wecollect/", http.StripPrefix("/wecollect/", wecollectui.WeCollectFiles()))
	mux.HandleFunc("/api/session", func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "local workspace", http.StatusServiceUnavailable)
	})
	var seen atomic.Int64
	seen.Store(time.Now().Unix())
	mux.HandleFunc("/alive", func(w http.ResponseWriter, r *http.Request) {
		seen.Store(time.Now().Unix())
		w.WriteHeader(http.StatusNoContent)
	})
	srv := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		startupWrite := r.Method == http.MethodPut && r.URL.Path == "/native/startup" && r.Header.Get("Origin") == "http://"+host
		if r.Host != host || (r.Method != "GET" && r.Method != "HEAD" && !startupWrite) {
			http.Error(w, "invalid request", 403)
			return
		}
		w.Header().Set("Content-Security-Policy", "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		mux.ServeHTTP(w, r)
	}), ReadHeaderTimeout: 5 * time.Second}
	go func() {
		ticker := time.NewTicker(time.Minute)
		defer ticker.Stop()
		for range ticker.C {
			if time.Now().Unix()-seen.Load() > 900 {
				srv.Close()
				return
			}
		}
	}()
	url := fmt.Sprintf("http://%s/wecollect/?local=1#key=%s", host, key)
	if len(os.Args) >= 2 && os.Args[1] == "-no-open" {
		fmt.Println(url)
	}
	if len(os.Args) < 2 || os.Args[1] != "-no-open" {
		if err = launch(url); err != nil {
			log.Print(err)
		}
	}
	if err = srv.Serve(l); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}
