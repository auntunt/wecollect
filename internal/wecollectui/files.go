package wecollectui

import (
	"embed"
	"io/fs"
	"net/http"
)

//go:embed site/*
var assets embed.FS

// WeCollectFiles serves the same workstation UI in the local launcher and in WeManage.
func WeCollectFiles() http.Handler {
	assetsFS, err := fs.Sub(assets, "site")
	if err != nil {
		panic(err)
	}
	return http.FileServer(http.FS(assetsFS))
}
