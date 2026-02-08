(() => {
    "use strict";
    var e = {
            8262: (e, t, n) => {
                n.d(t, {
                    Z: () => S
                });
                var o = n(8081),
                    a = n.n(o),
                    i = n(3645),
                    r = n.n(i),
                    s = n(1667),
                    l = n.n(s),
                    c = new URL(n(4207), n.b),
                    d = new URL(n(5587), n.b),
                    u = new URL(n(970), n.b),
                    g = new URL(n(1601), n.b),
                    p = new URL(n(8215), n.b),
                    m = new URL(n(862), n.b),
                    f = new URL(n(2887), n.b),
                    h = new URL(n(2489), n.b),
                    w = r()(a()),
                    _ = l()(c),
                    y = l()(d),
                    x = l()(u),
                    v = l()(g),
                    b = l()(p),
                    R = l()(m),
                    E = l()(f),
                    L = l()(h);
                w.push([e.id, `.extension__download_post{display:block;margin:6px 0 0 7px;cursor:pointer;width:30px;height:28px;background-image:url(${_});background-repeat:no-repeat;background-color:#fff;border-radius:3px;background-position:2px 0}.extension__download_post.reels{margin:0 0 20px 0;background-color:#fff;border-radius:3px;height:30px;background-position:0px 0;background-image:url(${y})}.extension__download_post.highlight,.extension__download_post.story{position:absolute;right:22px;top:58px;z-index:100000;background-color:rgba(0,0,0,0);background-position:0;background-image:url(${x})}.linkover{position:absolute;right:4px;bottom:4px;z-index:10000;display:none}div:hover>.extension__download_post.linkover{display:block !important}.extension__download_post.downloading{background-image:url('data:image/svg+xml;utf8,<svg width="28" height="28" fill="green" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><style>.spinner_P7sC{transform-origin:center;animation:spinner_svv2 .75s infinite linear}@keyframes spinner_svv2{100%{transform:rotate(360deg)}}</style><path d="M10.14,1.16a11,11,0,0,0-9,8.92A1.59,1.59,0,0,0,2.46,12,1.52,1.52,0,0,0,4.11,10.7a8,8,0,0,1,6.66-6.61A1.42,1.42,0,0,0,12,2.69h0A1.57,1.57,0,0,0,10.14,1.16Z" class="spinner_P7sC"/></svg>')}@keyframes opac{0%{opacity:0}100%{opacity:1}}.extension__download_post:hover{opacity:.9;cursor:pointer}.extension__notification_container{position:fixed;bottom:10px;right:10px;z-index:10000}.extension__notification_container .extension__notification{width:240px;margin-bottom:10px;box-shadow:0px 0px 1px 1px #ddd;background-color:#fff;color:#222;padding:20px;border-radius:4px;font-size:14px;border-top:5px solid #228b22}.extension__notification_container .extension__notification .extension__submessage{margin-top:10px;font-weight:bold}.extension__notification_container .extension__notification .extension__submessage a.button{display:block;text-decoration:none;background-color:#ff5252;color:#fff;padding:4px 4px;border-radius:4px;margin-top:6px;text-align:center;font-size:15px;display:block;font-weight:normal}.extension__notification_container .extension__notification .extension__submessage a.button:hover{background-color:#d12d2d}.extension__notification_container .extension__notification .extension__submessage a.link{display:block;color:#0e3f69;text-align:center;margin-top:10px;font-size:14px}.extension__notification_container .extension__notification .content-container{width:100%;margin-left:6px}.extension__notification_container .extension__notification .content-container .title{font-weight:500;margin-bottom:2px;font-size:13px}.extension__notification_container .extension__notification .content-container .content{font-size:12px}.extension__notification_container .extension__notification .icon{background:no-repeat url(${v});width:28px;height:24px}.extension__notification_container .extension__notification.system{padding:20px 10px}.extension__notification_container .extension__notification.system .icon{background:no-repeat url(${b})}.extension__notification_container .extension__notification.error .icon{background:no-repeat url(${R})}.extension__notification_container .extension__notification.downloading .icon{background:no-repeat url(${E})}.extension__notification_container .extension__notification .close-button{background:no-repeat url(${L});width:28px;height:16px;background-position:top right;margin-left:auto;cursor:pointer}`, ""]);
                const S = w
            },
            3645: e => {
                e.exports = function(e) {
                    var t = [];
                    return t.toString = function() {
                        return this.map((function(t) {
                            var n = "",
                                o = void 0 !== t[5];
                            return t[4] && (n += "@supports (".concat(t[4], ") {")), t[2] && (n += "@media ".concat(t[2], " {")), o && (n += "@layer".concat(t[5].length > 0 ? " ".concat(t[5]) : "", " {")), n += e(t), o && (n += "}"), t[2] && (n += "}"), t[4] && (n += "}"), n
                        })).join("")
                    }, t.i = function(e, n, o, a, i) {
                        "string" == typeof e && (e = [
                            [null, e, void 0]
                        ]);
                        var r = {};
                        if (o)
                            for (var s = 0; s < this.length; s++) {
                                var l = this[s][0];
                                null != l && (r[l] = !0)
                            }
                        for (var c = 0; c < e.length; c++) {
                            var d = [].concat(e[c]);
                            o && r[d[0]] || (void 0 !== i && (void 0 === d[5] || (d[1] = "@layer".concat(d[5].length > 0 ? " ".concat(d[5]) : "", " {").concat(d[1], "}")), d[5] = i), n && (d[2] ? (d[1] = "@media ".concat(d[2], " {").concat(d[1], "}"), d[2] = n) : d[2] = n), a && (d[4] ? (d[1] = "@supports (".concat(d[4], ") {").concat(d[1], "}"), d[4] = a) : d[4] = "".concat(a)), t.push(d))
                        }
                    }, t
                }
            },
            1667: e => {
                e.exports = function(e, t) {
                    return t || (t = {}), e ? (e = String(e.__esModule ? e.default : e), /^['"].*['"]$/.test(e) && (e = e.slice(1, -1)), t.hash && (e += t.hash), /["'() \t\n]|(%20)/.test(e) || t.needQuotes ? '"'.concat(e.replace(/"/g, '\\"').replace(/\n/g, "\\n"), '"') : e) : e
                }
            },
            8081: e => {
                e.exports = function(e) {
                    return e[1]
                }
            },
            3379: e => {
                var t = [];

                function n(e) {
                    for (var n = -1, o = 0; o < t.length; o++)
                        if (t[o].identifier === e) {
                            n = o;
                            break
                        } return n
                }

                function o(e, o) {
                    for (var i = {}, r = [], s = 0; s < e.length; s++) {
                        var l = e[s],
                            c = o.base ? l[0] + o.base : l[0],
                            d = i[c] || 0,
                            u = "".concat(c, " ").concat(d);
                        i[c] = d + 1;
                        var g = n(u),
                            p = {
                                css: l[1],
                                media: l[2],
                                sourceMap: l[3],
                                supports: l[4],
                                layer: l[5]
                            };
                        if (-1 !== g) t[g].references++, t[g].updater(p);
                        else {
                            var m = a(p, o);
                            o.byIndex = s, t.splice(s, 0, {
                                identifier: u,
                                updater: m,
                                references: 1
                            })
                        }
                        r.push(u)
                    }
                    return r
                }

                function a(e, t) {
                    var n = t.domAPI(t);
                    n.update(e);
                    return function(t) {
                        if (t) {
                            if (t.css === e.css && t.media === e.media && t.sourceMap === e.sourceMap && t.supports === e.supports && t.layer === e.layer) return;
                            n.update(e = t)
                        } else n.remove()
                    }
                }
                e.exports = function(e, a) {
                    var i = o(e = e || [], a = a || {});
                    return function(e) {
                        e = e || [];
                        for (var r = 0; r < i.length; r++) {
                            var s = n(i[r]);
                            t[s].references--
                        }
                        for (var l = o(e, a), c = 0; c < i.length; c++) {
                            var d = n(i[c]);
                            0 === t[d].references && (t[d].updater(), t.splice(d, 1))
                        }
                        i = l
                    }
                }
            },
            569: e => {
                var t = {};
                e.exports = function(e, n) {
                    var o = function(e) {
                        if (void 0 === t[e]) {
                            var n = document.querySelector(e);
                            if (window.HTMLIFrameElement && n instanceof window.HTMLIFrameElement) try {
                                n = n.contentDocument.head
                            } catch (e) {
                                n = null
                            }
                            t[e] = n
                        }
                        return t[e]
                    }(e);
                    if (!o) throw new Error("Couldn't find a style target. This probably means that the value for the 'insert' parameter is invalid.");
                    o.appendChild(n)
                }
            },
            9216: e => {
                e.exports = function(e) {
                    var t = document.createElement("style");
                    return e.setAttributes(t, e.attributes), e.insert(t, e.options), t
                }
            },
            3565: (e, t, n) => {
                e.exports = function(e) {
                    var t = n.nc;
                    t && e.setAttribute("nonce", t)
                }
            },
            7795: e => {
                e.exports = function(e) {
                    if ("undefined" == typeof document) return {
                        update: function() {},
                        remove: function() {}
                    };
                    var t = e.insertStyleElement(e);
                    return {
                        update: function(n) {
                            ! function(e, t, n) {
                                var o = "";
                                n.supports && (o += "@supports (".concat(n.supports, ") {")), n.media && (o += "@media ".concat(n.media, " {"));
                                var a = void 0 !== n.layer;
                                a && (o += "@layer".concat(n.layer.length > 0 ? " ".concat(n.layer) : "", " {")), o += n.css, a && (o += "}"), n.media && (o += "}"), n.supports && (o += "}");
                                var i = n.sourceMap;
                                i && "undefined" != typeof btoa && (o += "\n/*# sourceMappingURL=data:application/json;base64,".concat(btoa(unescape(encodeURIComponent(JSON.stringify(i)))), " */")), t.styleTagTransform(o, e, t.options)
                            }(t, e, n)
                        },
                        remove: function() {
                            ! function(e) {
                                if (null === e.parentNode) return !1;
                                e.parentNode.removeChild(e)
                            }(t)
                        }
                    }
                }
            },
            4589: e => {
                e.exports = function(e, t) {
                    if (t.styleSheet) t.styleSheet.cssText = e;
                    else {
                        for (; t.firstChild;) t.removeChild(t.firstChild);
                        t.appendChild(document.createTextNode(e))
                    }
                }
            },
            8215: e => {
                e.exports = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" fill="green" height="24" viewBox="0 -960 960 960" width="24"><path d="M720-120H280v-520l280-280 50 50q7 7 11.5 19t4.5 23v14l-44 174h258q32 0 56 24t24 56v80q0 7-2 15t-4 15L794-168q-9 20-30 34t-44 14Zm-360-80h360l120-280v-80H480l54-220-174 174v406Zm0-406v406-406Zm-80-34v80H160v360h120v80H80v-520h200Z"/></svg>'
            },
            2887: e => {
                e.exports = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" fill="green"><path d="M10.95 21.75q-1.875-.2-3.462-1.05-1.588-.85-2.763-2.162-1.175-1.313-1.825-3Q2.25 13.85 2.25 12q0-3.8 2.488-6.588 2.487-2.787 6.237-3.162V3.9q-3.025.425-5.05 2.712Q3.9 8.9 3.9 12t2 5.387q2 2.288 5.05 2.713ZM12 16.8l-4.8-4.775L8.325 10.9l2.825 2.825V7.2h1.65v6.525l2.85-2.85 1.125 1.15Zm1 4.95V20.1q1.1-.15 2.113-.575Q16.125 19.1 17 18.45l1.2 1.2q-1.15.9-2.462 1.412-1.313.513-2.738.688Zm4.05-16.2q-.875-.65-1.9-1.075-1.025-.425-2.125-.575V2.25q1.4.15 2.713.662 1.312.513 2.462 1.413Zm2.55 12.6L18.45 17q.675-.875 1.088-1.887Q19.95 14.1 20.1 13h1.65q-.175 1.4-.7 2.737-.525 1.338-1.45 2.413Zm.5-7.15q-.15-1.1-.562-2.113Q19.125 7.875 18.45 7l1.2-1.15q.9 1.1 1.425 2.4.525 1.3.675 2.75Z"/></svg>'
            },
            1601: e => {
                e.exports = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" fill="green"><path d="M5.1 20v-1.65h13.85V20Zm4.45-4.15-5.6-5.575L5.125 9.1l4.425 4.425 9.375-9.375L20.1 5.325Z"/></svg>'
            },
            862: e => {
                e.exports = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" fill="red"><path d="M12 16.85q.35 0 .613-.237.262-.238.262-.613t-.25-.625q-.25-.25-.625-.25-.35 0-.613.25-.262.25-.262.625 0 .35.25.6t.625.25Zm-.8-3.75h1.65V6.95H11.2Zm.8 8.7q-2.025 0-3.812-.775-1.788-.775-3.113-2.1-1.325-1.325-2.1-3.113Q2.2 14.025 2.2 12t.775-3.825q.775-1.8 2.1-3.125Q6.4 3.725 8.188 2.962 9.975 2.2 12 2.2t3.825.762q1.8.763 3.125 2.088 1.325 1.325 2.088 3.112Q21.8 9.95 21.8 12t-.762 3.825q-.763 1.775-2.088 3.1-1.325 1.325-3.112 2.1Q14.05 21.8 12 21.8Zm0-1.65q3.425 0 5.788-2.363Q20.15 15.425 20.15 12t-2.362-5.788Q15.425 3.85 12 3.85q-3.425 0-5.787 2.362Q3.85 8.575 3.85 12q0 3.425 2.363 5.787Q8.575 20.15 12 20.15ZM12 12Z"/></svg>'
            },
            970: e => {
                e.exports = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" fill="rgb%28255, 255, 255%29" height="30" width="30" viewBox="0 0 22 22"><path d="M7.1 16.9h9.8v-1.65H7.1Zm4.9-3.15 3.8-3.8-1.15-1.15-1.85 1.875V5.95h-1.65v4.675L9.35 8.8 8.2 9.95Zm0 8.05q-2.025 0-3.812-.775-1.788-.775-3.113-2.1-1.325-1.325-2.1-3.113Q2.2 14.025 2.2 12t.775-3.825q.775-1.8 2.1-3.125Q6.4 3.725 8.188 2.962 9.975 2.2 12 2.2t3.825.762q1.8.763 3.125 2.088 1.325 1.325 2.088 3.112Q21.8 9.95 21.8 12t-.762 3.825q-.763 1.775-2.088 3.1-1.325 1.325-3.112 2.1Q14.05 21.8 12 21.8Zm0-1.65q3.425 0 5.788-2.363Q20.15 15.425 20.15 12t-2.362-5.788Q15.425 3.85 12 3.85q-3.425 0-5.787 2.362Q3.85 8.575 3.85 12q0 3.425 2.363 5.787Q8.575 20.15 12 20.15ZM12 12Z"/></svg>'
            },
            2489: e => {
                e.exports = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" height="20" width="20" viewBox="0 0 30 30"><path d="m6.3 18.9-1.15-1.2 5.675-5.7L5.15 6.25l1.15-1.2 5.725 5.75L17.7 5.05l1.15 1.2L13.175 12l5.675 5.7-1.15 1.2-5.675-5.75Z"/></svg>'
            },
            4207: e => {
                e.exports = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" height="24" width="24" viewBox="0 0 22 22"><path d="M7.1 16.9h9.8v-1.65H7.1Zm4.9-3.15 3.8-3.8-1.15-1.15-1.85 1.875V5.95h-1.65v4.675L9.35 8.8 8.2 9.95Zm0 8.05q-2.025 0-3.812-.775-1.788-.775-3.113-2.1-1.325-1.325-2.1-3.113Q2.2 14.025 2.2 12t.775-3.825q.775-1.8 2.1-3.125Q6.4 3.725 8.188 2.962 9.975 2.2 12 2.2t3.825.762q1.8.763 3.125 2.088 1.325 1.325 2.088 3.112Q21.8 9.95 21.8 12t-.762 3.825q-.763 1.775-2.088 3.1-1.325 1.325-3.112 2.1Q14.05 21.8 12 21.8Zm0-1.65q3.425 0 5.788-2.363Q20.15 15.425 20.15 12t-2.362-5.788Q15.425 3.85 12 3.85q-3.425 0-5.787 2.362Q3.85 8.575 3.85 12q0 3.425 2.363 5.787Q8.575 20.15 12 20.15ZM12 12Z"/></svg>'
            },
            5587: e => {
                e.exports = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" height="28" width="28" viewBox="0 0 22 22"><path d="M7.1 16.9h9.8v-1.65H7.1Zm4.9-3.15 3.8-3.8-1.15-1.15-1.85 1.875V5.95h-1.65v4.675L9.35 8.8 8.2 9.95Zm0 8.05q-2.025 0-3.812-.775-1.788-.775-3.113-2.1-1.325-1.325-2.1-3.113Q2.2 14.025 2.2 12t.775-3.825q.775-1.8 2.1-3.125Q6.4 3.725 8.188 2.962 9.975 2.2 12 2.2t3.825.762q1.8.763 3.125 2.088 1.325 1.325 2.088 3.112Q21.8 9.95 21.8 12t-.762 3.825q-.763 1.775-2.088 3.1-1.325 1.325-3.112 2.1Q14.05 21.8 12 21.8Zm0-1.65q3.425 0 5.788-2.363Q20.15 15.425 20.15 12t-2.362-5.788Q15.425 3.85 12 3.85q-3.425 0-5.787 2.362Q3.85 8.575 3.85 12q0 3.425 2.363 5.787Q8.575 20.15 12 20.15ZM12 12Z"/></svg>'
            }
        },
        t = {};

    function n(o) {
        var a = t[o];
        if (void 0 !== a) return a.exports;
        var i = t[o] = {
            id: o,
            exports: {}
        };
        return e[o](i, i.exports, n), i.exports
    }
    n.m = e, n.n = e => {
        var t = e && e.__esModule ? () => e.default : () => e;
        return n.d(t, {
            a: t
        }), t
    }, n.d = (e, t) => {
        for (var o in t) n.o(t, o) && !n.o(e, o) && Object.defineProperty(e, o, {
            enumerable: !0,
            get: t[o]
        })
    }, n.o = (e, t) => Object.prototype.hasOwnProperty.call(e, t), n.b = document.baseURI || self.location.href, n.nc = void 0, (() => {
        var e = null,
            t = {},
            o = {};
        const a = "chrome",
            i = "IGDownloader",
            r = "https://onlinetoolset.com/browser-extensions/downloader-for-instagram",
            s = `${r}#contact-form`,
            l = ["en", "tr", "zh-cn", "hi", "ru", "de", "fr", "el", "es", "ja", "ko", "nl", "da", "fi", "it", "no", "sv", "cs", "pl", "pt", "hu", "ro", "bg"],
            c = {
                firefox: {
                    RATE_US_URL: "https://addons.mozilla.org/tr/firefox/addon/downloader-instagram/reviews/",
                    OTHER_EXTENSIONS: [{
                        name: "Anonymously Story Viewer",
                        description: "Keep yourself secret. View instagram stories anonymously.",
                        slug: "storyviewer",
                        url: "https://addons.mozilla.org/en-US/firefox/addon/anonymously-story-viewer-insta/"
                    }, {
                        name: "Website Image Downloader",
                        description: "Download images from any website.",
                        slug: "webdownloader",
                        url: "https://addons.mozilla.org/en-US/firefox/addon/website-image-downloader/"
                    }]
                },
                chrome: {
                    IS_POLL_ACTIVE: !0,
                    RATE_US_URL: "https://chromewebstore.google.com/detail/fkilgeompmipodhkdmafejpfgnfbjmkk/reviews",
                    OTHER_EXTENSIONS: [{
                        name: "Anonymously Story Viewer",
                        description: "Keep yourself secret. View instagram stories anonymously.",
                        slug: "storyviewer",
                        url: "https://chromewebstore.google.com/detail/anonymously-story-viewer/peplbgpalimccdhgjhcjmclikckonddj"
                    }, {
                        name: "Stylish Text Generator",
                        description: "Generate stylish texts easily. 🆆🆁🅸🆃🅴 🅃🄴🅇🅃 𝔦𝔫 𝕕𝕚𝕗𝕗𝕖𝕣𝕖𝕟𝕥 🅢🅣🅨🅛🅔",
                        slug: "fancytext",
                        url: "https://onlinetoolset.com/font-generator-fancy-text"
                    }]
                },
                edge: {
                    RATE_US_URL: "https://microsoftedge.microsoft.com/addons/detail/downloader-for-instagram%E2%84%A2/namonicimcioocdmnhaalhaabjdcefje",
                    OTHER_EXTENSIONS: [{
                        name: "Shortcut from AddressBar",
                        description: "Reach visited websites easily.",
                        slug: "shortbar",
                        url: "https://microsoftedge.microsoft.com/addons/detail/shortcut-on-browser-addre/pioagdedbjcinmdbhmgmggaepcmjlhco"
                    }, {
                        name: "Fancy Font Generator",
                        description: "Generate stylish texts easily. 🆆🆁🅸🆃🅴 🅃🄴🅇🅃 𝔦𝔫 𝕕𝕚𝕗𝕗𝕖𝕣𝕖𝕟𝕥 🅢🅣🅨🅛🅔",
                        slug: "fancytext",
                        url: "https://onlinetoolset.com/font-generator-fancy-text"
                    }]
                },
                opera: {
                    RATE_US_URL: null,
                    OTHER_EXTENSIONS: []
                }
            } [a];
        class d {
            static async send(e, t) {
                if ("firefox" == a) return !0;
                const n = chrome.runtime.getManifest(),
                    o = n.short_name.replaceAll(" ", ""),
                    i = (await chrome.storage.local.get({
                        user: null
                    })).user,
                    r = chrome.runtime.getPlatformInfo ? await chrome.runtime.getPlatformInfo() : {
                        os: ""
                    },
                    s = chrome.i18n.getUILanguage(),
                    l = t || {};
                l.userID = i.userID, l.extVersion = n.version;
                const c = {
                    client_id: o,
                    non_personalized_ads: !1,
                    user_id: i.userID,
                    user_properties: {
                        language: {
                            value: s
                        },
                        platform: {
                            value: r.os
                        },
                        browser: {
                            value: a
                        },
                        createdAt: {
                            value: i.createdAt
                        }
                    },
                    events: [{
                        name: `${o}__${e}`,
                        params: l
                    }]
                };
                fetch("https://www.google-analytics.com/mp/collect?measurement_id=G-EK4FB6D2SD&api_secret=ZYmxhYeDS7yp0OfFPsZnfg", {
                    method: "POST",
                    cache: "no-cache",
                    mode: "no-cors",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify(c)
                }).catch((e => {
                    console.log(e)
                }))
            }
            static async error(e, t) {
                const n = t || {};
                n.errorMessage = e.toString(), d.send("Error", n)
            }
        }
        const u = (e, t) => {
                const n = chrome.runtime.getManifest();
                try {
                    const o = new URL(e);
                    if (o.origin.includes("onlinetoolset.com")) {
                        const e = chrome.i18n.getUILanguage().replace("_", "_").toLowerCase();
                        l.includes(e) && (o.pathname = `/${e}${o.pathname}`)
                    }
                    return o.searchParams.append("utm_source", n.short_name.replace(" ", "")), o.searchParams.append("utm_medium", t), o.searchParams.append("utm_content", "extension"), o.searchParams.append("utm_campaign", `version_${n.version}`), o.searchParams.append("utm_browser", `${a}`), o.toString()
                } catch (t) {
                    return d.error(t, {
                        pageURL: "callback:generateURL"
                    }), e
                }
            },
            g = async () => ({
                imageSize: "large",
                filenamePattern: "username__createdDate",
                ...await chrome.storage.sync.get(["imageSize", "filenamePattern"])
            });
        var p = new class {
            WEB_URL = "https://www.instagram.com";
            API_URL = "https://i.instagram.com/api/v1";
            GRAPHQL_URL = "https://www.instagram.com/graphql/query";
            REGEX_PATTERNS = {
                "user-id": new RegExp('profilePage_(.*?)"'),
                "post-id": new RegExp('"page_id":"postPage_([0-9_-]*)"')
            };
            static isInstagram(e) {
                return this.parseURL(e).isInstagram
            }
            static isPostDetailUrl(e) {
                return "post_detail" == this.parseURL(e).pageType
            }
            static isProfileDetailUrl(e) {
                return "profile_detail" == this.parseURL(e).pageType
            }
            static extraPostDetailUrl(e) {
                return this.parseURL(e).params.postCode
            }
            static getPostCodeByURL(e) {
                return this.parseURL(e).params.postCode
            }
            static getUsernameByURL(e) {
                return this.parseURL(e).params.username
            }
            static parseURL(e) {
                const t = ["explore", "reels", "direct", "accounts", "language", "emails", "push", "settings", "download", ""];
                try {
                    const n = new URL(e),
                        o = n.pathname.split("/").filter((e => "" != e));
                    let a = "",
                        i = {};
                    return o.length > 0 && (t.includes(o[0]) ? a = "static_page" : "p" == o[0] ? (a = "post_detail", i.postCode = o.length > 1 ? o[1] : null) : 1 == o.length || 2 == o.length && ["reels", "tagged", "followers", "following"].includes(o[1]) ? (a = "profile_detail", i.username = o[0]) : a = "static_page"), {
                        isInstagram: n.origin.endsWith("instagram.com"),
                        pageType: a,
                        paths: o,
                        params: i
                    }
                } catch (e) {
                    return {
                        isInstagram: !1,
                        pageType: "",
                        paths: [],
                        params: {},
                        error: e.toString()
                    }
                }
            }
            async isLoggedIn() {
                return (await fetch("/accounts/login/")).redirected
            }
            async getUserIDByProfileURL(e) {
                console.debug(`getUserIDByProfileURL: ${e}`);
                let t = (await fetch(e).then((e => e.text()))).match(this.REGEX_PATTERNS["user-id"]);
                return t ? t[1] : null
            }
            async getUserByUsername(e) {
                if (console.debug(`getUserByUsername: ${e}`), !(e in t)) {
                    const n = `users/web_profile_info/?username=${e}`,
                        o = await this.sendAPIRequestByPath(n);
                    if (!o || !o.data) throw new Error("The user can not be fetched from instagram.");
                    (t = {})[e] = o.data.user
                }
                return t[e]
            }
            async getUserStories(e) {
                if (console.debug(`getUserStories: ${e}`), !(e in o)) {
                    const t = `feed/reels_media/?reel_ids=${e}`,
                        n = await this.sendAPIRequestByPath(t);
                    if (!(n && "ok" == n.status && Object.keys(n.reels || {}).length > 0)) throw new Error("Stories could not be fetched from instagram.");
                    (o = {})[e] = n
                }
                return o[e]
            }
            async getUserHighlights(e) {
                let t = `query_hash=d4d88dc1500312af6f937f7b804c68c3&user_id=${e}&include_chaining=false&include_reel=true&include_suggested_users=false&include_logged_out_extras=false&include_live_status=false&include_highlight_reels=true`;
                return this.sendGraphqlRequest(t)
            }
            async getHighlightItems(e) {
                console.debug(`getHighlightItems: ${e}`);
                const t = `feed/reels_media/?reel_ids=highlight:${e}`;
                return await this.sendAPIRequestByPath(t)
            }
            async getPostDetail(e) {
                console.debug(`getPostDetail: ${e}`);
                let t = `media/${e}/info/`;
                return (await this.sendAPIRequestByPath(t)).items[0]
            }
            async getPostIDByPostURL(e) {
                console.debug(`getPostIDByPostURL: ${e}`);
                let t = (await fetch(e).then((e => e.text()))).match(this.REGEX_PATTERNS["post-id"]);
                return t ? t[1] : t[0]
            }
            sendAPIRequestByPath(e) {
                let t = `${this.API_URL}/${e}`;
                return this.sendAPIRequest(t)
            }
            sendGraphqlRequest(e) {
                let t = `${this.GRAPHQL_URL}/?${e}`;
                return this.sendAPIRequest(t)
            }
            sendAPIRequest(e) {
                return new Promise((async (t, n) => {
                    let o = await this.getAppID(),
                        a = new XMLHttpRequest;
                    a.open("GET", e, !0), a.setRequestHeader("x-ig-app-id", o), a.withCredentials = !0, a.responseType = "json", a.onload = () => {
                        200 == a.status ? t(a.response) : n(`IGClientResponseError_${a.status}`)
                    }, a.onerror = e => {
                        n("IGClientRequestError")
                    }, a.ontimeout = e => {
                        n("IGClientTimeoutError")
                    }, a.send()
                }))
            }
            async getAppID() {
                let t = document.documentElement.innerText.match('customHeaders":{"X-IG-App-ID":"(.*?)"');
                if (t) e = t[1];
                else if (null == e) {
                    let t = await fetch("/").then((e => e.text()));
                    e = t.match('customHeaders":{"X-IG-App-ID":"(.*?)"')[1]
                }
                return e
            }
        };
        const m = (e, t) => {
                let n = null;
                switch (t.imageSize) {
                    case "large":
                        n = e.candidates[0];
                        break;
                    case "medium":
                        let t = Math.ceil(e.candidates.length / 4);
                        n = e.candidates.at(t);
                        break;
                    case "small":
                        n = e.candidates.at(-1)
                }
                return n
            },
            f = (e, t, n) => {
                let o = t;
                return o = o.replaceAll("username", e.username), o = o.replaceAll("description", e.description), o = o.replaceAll("location", e.location), o = o.replaceAll("createdDate", e.createdDate), o = o.replaceAll(new RegExp("[\r\n\t⁠⁡⁢⁣⁤⁦⁧⁨⁩⁪⁫⁬⁭⁮⁯ ​‌‍‎‏]", "g"), " "), o = o.replaceAll(new RegExp('[:*<>/\\|?*~"]', "g"), ""), o = o.slice(0, 240).trim(), n && (o = o + "_" + n), o
            };

        function h(e) {
            let t = {
                    code: e.code,
                    user_id: e.user.pk,
                    username: e.user.username,
                    user_full_name: e.user.user_full_name,
                    location: e.location ? e.location.name || e.location.short_name : "",
                    description: e.caption ? e.caption.text : "",
                    createdDate: new Date(1e3 * e.taken_at).toISOString(),
                    createdTimestamp: e.taken_at,
                    items: []
                },
                n = e => ({
                    type: e.video_versions ? "video" : "image",
                    candidates: e.video_versions || e.image_versions2.candidates
                });
            return e.video_versions ? t.items.push(n(e)) : e.carousel_media ? e.carousel_media.forEach((e => t.items.push(n(e)))) : t.items.push(n(e)), t
        }
        // async function w(e, t) {
        //     const n = document.createElement("a");
        //     return n.download = t, n.href = await async function(e) {
        //         return fetch(e).then((e => e.blob())).then((e => URL.createObjectURL(e)))
        //     }(e), n.click(), !0
        // }
        // async function _(e) {
        //     const t = `/p/${e}/`,
        //         n = await g(),
        //         o = await p.getPostIDByPostURL(t),
        //         a = h(await p.getPostDetail(o)),
        //         i = [];
        //     let r = 0;
        //     for (let e of a.items) {
        //         const t = m(e, n);
        //         let o = "video" == e.type ? "mp4" : "jpg",
        //             s = `${f(a,n.filenamePattern,1==a.items.length?null:r)}.${o}`;
        //         await w(t.url, s), i.push(s), r += 1
        //     }
        //     return {
        //         count: a.items.length,
        //         filenames: i
        //     }
        // }
        async function _(e) {
            const t = `/p/${e}/`,
                    n = await g(),                  // settings
                    o = await p.getPostIDByPostURL(t),
                    a = h(await p.getPostDetail(o));

            const downloads = [];
            let r = 0;

            for (let item of a.items) {
                const candidate = m(item, n) || item.candidates?.[0];
                if (!candidate || !candidate.url) {
                console.warn("Skipping item (no URL)", item);
                r++;
                continue;
                }

                const ext = item.type === "video" ? "mp4" : "jpg";
                const filename = `${f(
                a,
                n.filenamePattern,
                a.items.length === 1 ? null : r
                )}.${ext}`;

                downloads.push({
                url: candidate.url,
                filename: filename
                });

                r++;
            }

            // 🔥 SEND ALL FILES AT ONCE
            chrome.runtime.sendMessage({
                type: "BATCH_DOWNLOAD",
                files: downloads
            });

            return {
                count: downloads.length,
                filenames: downloads.map(d => d.filename)
            };
        }
        async function y(e, t) {
            const n = h(e),
                o = await g(),
                a = n.items[0],
                i = a.candidates[0],
                r = "video" == a.type ? "mp4" : "jpg",
                s = `${f(n,o.filenamePattern,1==n.items.length?null:0)}.${r}`;
            // return await w(i.url, s), s
            chrome.runtime.sendMessage({
                type: "BATCH_DOWNLOAD",
                files: [{
                    url: i.url,
                    filename: s
                }]
            });
            return s;
        }
        async function x() {
            return (await chrome.storage.local.get({
                extensionConfig: {}
            })).extensionConfig
        }

        function v() {
            return parseInt(Date.now() / 1e3)
        }
        async function b(e, t) {
            const n = (await chrome.storage.local.get({
                    SeenNotifications: {}
                })).SeenNotifications,
                o = Object.keys(n),
                r = v(),
                s = Object.values(n).map((e => e.time)),
                l = Math.max(...s);
            if (r < l + t) return null;
            const d = (await async function() {
                const e = await x();
                return e.notifications ? e.notifications : c.RATE_US_URL ? [{
                    slug: "RateUS",
                    title: "Enjoy the extension?",
                    message: "Your support helps us improve! If you find the extension useful, please take a moment to rate us. Your feedback makes a big difference.",
                    category: "self-extension",
                    type: "rate-us",
                    confirmLabel: "Rate now",
                    url: c.RATE_US_URL,
                    frequency: {}
                }] : []
            }()).map((e => {
                if ("urls" in e && (e.url = e.urls[a] || null), e.nextViewTime = r, e.slug in n) {
                    const t = n[e.slug],
                        o = e.frequency[t.action] || 5,
                        a = t.time + 86400 * o;
                    e.nextViewTime = a
                }
                return e
            })).filter((t => t.slug != i && (!!t.url && (!e || t.category === e)))).sort(((e, t) => e.nextViewTime - t.nextViewTime));
            if (d.length > 0) {
                const e = d.filter((e => 0 == o.includes(e.slug)));
                if (e.length > 0) return e[0];
                const t = d.filter((e => ["RateUs", "FeatureRequest", "ShareFeedback"].includes(e.slug)));
                return console.log(d, t), t.length > 0 ? t[0] : d[0]
            }
            return null
        }
        async function R(e, t) {
            const n = await chrome.storage.local.get({
                SeenNotifications: {}
            });
            n.SeenNotifications[e] = {
                action: t,
                time: v()
            }, d.send("Notification", {
                slug: e,
                action: t
            }), await chrome.storage.local.set({
                SeenNotifications: n.SeenNotifications
            })
        }
        var E = n(3379),
            L = n.n(E),
            S = n(7795),
            k = n.n(S),
            C = n(569),
            D = n.n(C),
            P = n(3565),
            q = n.n(P),
            U = n(9216),
            A = n.n(U),
            T = n(4589),
            I = n.n(T),
            $ = n(8262),
            M = {};
        M.styleTagTransform = I(), M.setAttributes = q(), M.insert = D().bind(null, "head"), M.domAPI = k(), M.insertStyleElement = A();
        L()($.Z, M);
        $.Z && $.Z.locals && $.Z.locals;
        var Z = null,
            Q = 0,
            j = "0000-00-00";
        try {
            j = (new Date).toISOString().split("T")[0]
        } catch (e) {}(new Date).getTime();
        async function O(e, t) {
            let n = t || {};
            n.pageURL = window.location.href, n.pageType = H(), chrome.runtime.sendMessage({
                action: "SEND_ACTIVITY",
                params: {
                    name: e,
                    data: n
                }
            })
        }
        async function B(e, t) {
            let n = t || {};
            n.pageURL = window.location.href, n.pageType = H(), n.userAgent = navigator ? navigator.userAgent : "NoUserAgent", chrome.runtime.sendMessage({
                action: "SEND_ERROR",
                params: {
                    error: `${e.toString()}`,
                    data: n
                }
            })
        }

        function N() {
            try {
                return window.location.pathname.split("/").filter((e => "" != e))
            } catch (e) {
                B(e, {
                    extCallback: "ContentScript:getCurrentURLPaths"
                })
            }
            return ""
        }

        function H() {
            const e = N();
            if (0 === e.length) return "HomePage";
            if (1 === e.length) return "reels" === e[0] ? "ReelsPage" : "explore" === e[0] ? "ExplorePage" : "ProfilePage";
            if (2 === e.length) {
                if ("reels" === e[0]) return "ReelsPage";
                if ("p" === e[0]) return "PostDetailPage";
                if ("reel" === e[0]) return "ReelDetailPage";
                if ("stories" === e[0]) return "StoryDetailPage";
                if ("tagged" === e[1]) return "UserTaggedPage";
                if ("reels" === e[1]) return "UserReelsPage"
            }
            if (3 === e.length) {
                if ("stories" === e[0]) return "StoryDetailPage";
                if ("saved" == e[1] && "all-posts" === e[1]) return "UserSavedAllPage";
                if ("saved" == e[1]) return "UserSavedCollectionPage";
                if ("stories" == e[0] && "highlights" === e[1]) return "HighlightDetailPage"
            }
            return e.join("-")
        }
        async function G(e) {
            let t = null;
            if (t = "service" == e ? await b("service", 172800) : await b(null, 345600), t) {
                var n = document.querySelector(".extension__notification_container");
                n || ((n = document.createElement("div")).classList.add("extension__notification_container"), document.body.insertAdjacentElement("afterbegin", n));
                const e = function(e) {
                    const t = u(e.url, "notification"),
                        n = `\n    <div class='extension__notification' style='width:300px'>\n        <h2 style='font-size: 16px; margin-bottom: 8px;'>${e.title}</h2>\n        ${e.message}\n        <div class='extension__submessage'>\n        </div>\n    </div>`,
                        o = (new DOMParser).parseFromString(n, "text/html"),
                        a = o.body.childNodes[0],
                        i = document.createElement("a");
                    i.innerText = e.confirmLabel, i.target = "_blank", i.classList.add("button"), i.onclick = () => {
                        a.remove(), R(e.slug, "confirm")
                    }, i.href = u(t, "content-notify");
                    const r = document.createElement("a");
                    return r.innerText = "Maybe Later", r.classList.add("link"), r.onclick = () => {
                        a.remove(), R(e.slug, "close")
                    }, a.querySelector(".extension__submessage").appendChild(i), a.querySelector(".extension__submessage").appendChild(r), R(e.slug, "view"), o.body.childNodes[0]
                }(t);
                return n.insertAdjacentElement("afterbegin", e), !0
            }
            return !1
        }

        function V(e, t) {
            try {
                ! function(e, t) {
                    (new Date).getTime();
                    var n = document.querySelector(".extension__notification_container");
                    n || ((n = document.createElement("div")).classList.add("extension__notification_container"), document.body.insertAdjacentElement("afterbegin", n));
                    const o = document.createElement("div");
                    o.classList.add("extension__notification"), o.innerText = e;
                    const a = document.createElement("div");
                    if (a.classList.add("extension__submessage"), t);
                    else {
                        a.innerText = "Please write us if the problem still happened.";
                        const e = document.createElement("a");
                        e.innerText = "Bug Report", e.classList.add("button"), e.target = "_blank", e.onclick = () => {
                            O("Click__content_bug_report")
                        }, e.href = u(s, "content-bug-report"), a.appendChild(e)
                    }
                    const i = document.createElement("a");
                    i.innerText = "Close", i.classList.add("link"), i.onclick = () => {
                        O("Click__content_close"), o.remove()
                    }, a.appendChild(i), o.appendChild(a), n.insertAdjacentElement("afterbegin", o), !0 === t && setTimeout((() => {
                        o.remove(), !G("service") && Q > 20 && G(null)
                    }), 2e3)
                }(e, t)
            } catch (e) {
                B(e, {
                    extCallback: "showMessage"
                })
            }
        }

        function z(e) {
            const t = e.length > 2 ? e[2] : null;
            var n = 0,
                o = 0,
                a = [...document.querySelectorAll(".x1ned7t2 > div")];
            if (a.length > 0)
                for (let e of a) e.childElementCount > 0 && (o = n), n += 1;
            else {
                a = document.querySelectorAll("header > ._ac3r > div"), n = 0;
                for (let e of a) e.childElementCount > 1 && (o = n), n += 1
            }
            return async function(e, t) {
                const n = await p.getHighlightItems(e),
                    o = n?.reels_media || [];
                if (o.length > 0) {
                    o[0]?.user?.username;
                    let e = (o[0].items || [])[t];
                    return e.user = o[0].user || {}, {
                        count: 1,
                        filenames: [await y(e, e.pk)]
                    }
                }
                throw new Error("We could not find any files.")
            }(t, o)
        }

        function W(e, t, n) {
            if (!n) {
                n = !0;
                try {
                    var o = null;
                    const n = window.location.pathname.split("/").filter((e => "" != e));
                    if (t.classList.add("downloading"), "highlight" == e.type) o = z(n);
                    else if ("story" == e.type) {
                        const e = n[1];
                        o = async function(e, t) {
                            const n = await p.getUserByUsername(e),
                                o = await p.getUserStories(n.id),
                                a = o?.reels_media || [];
                            if (!(a.length > 0)) throw new Error("We could not find any files.");
                            {
                                let e = a[0].items[0];
                                if (t) {
                                    const n = a[0].items.filter((e => e.pk == t));
                                    e = n.length > 0 ? n[0] : e
                                }
                                if (e.user = a[0].user || {}, e) return {
                                    count: 1,
                                    filenames: [await y(e, e.pk)]
                                }
                            }
                        }(e, n[2] || null)
                    } else if ("reels" == n[0] && 2 == n.length) o = _(n[1]);
                    else {
                        var a = e.code || function() {
                            const e = N();
                            return e.length >= 2 && ["reels", "reel", "p"].includes(e[0]) && e[1] || null
                        }();
                        a && (o = _(a))
                    }
                } catch (t) {
                    B(t, {
                        extCallback: `ContentScript:DownloadButtonClick_${e.type}_${e.code}`
                    })
                }
                return o ? o.then((o => {
                    if (n = !1, t.classList.add("downloaded"), t.classList.remove("downloading"), !o || !o.filenames) throw new Error("Could not be found download file.");
                    {
                        O("Download", e);
                        const t = o.filenames.length > 1 ? `${o.filenames.length} files downloading. Please check the download folders.` : `${o.filenames[0]} has been downloading. Please check the download folders.`;
                        !async function() {
                            try {
                                const e = await chrome.storage.local.get({
                                    DownloadCount: 0,
                                    DailyDownloadCounts: {}
                                });
                                j in e.DailyDownloadCounts == 0 && (e.DailyDownloadCounts[j] = 0), e.DailyDownloadCounts[j] += 1, e.DailyDownloadCounts[j], Q += 1;
                                for (const t in e.DailyDownloadCounts) t !== j && (O("DailyDownloadCount", {
                                    CurrentDate: t,
                                    DownloadCount: e.DailyDownloadCounts[t]
                                }), delete e.DailyDownloadCounts[t]);
                                chrome.storage.local.set({
                                    DownloadCount: e.DownloadCount + 1,
                                    DailyDownloadCounts: e.DailyDownloadCounts
                                })
                            } catch (e) {
                                B(e, {
                                    extCallback: "ContentScript:increaseDownloadCount"
                                })
                            }
                        }(), V(t, !0)
                    }
                })).catch((async o => {
                    if (n = !1, t.classList.remove("downloading"), 0 == (await fetch("/accounts/login/")).redirected) return V("You must be logged in to download from instagram. Please login and try again."), void B("IGLoginError", {
                        extCallback: `ContentScript:DownloadButtonClickCatch_${e.type}`
                    });
                    const a = o.toString();
                    a.includes("IGClientResponseError_429") ? V('Occured "Too Many Request" error on instagram. Please re-open this page on a new tab and try again.') : a.includes("IGClientRequestError") ? V("Occured an error on instagram. Please re-open this page on a new tab and try again.") : a.includes("We could not find any files.") ? V("We could not find and downloadable files. Please re-open this page on a new tab and try again.") : V("Occured unknown error. Please re-open this page and try again."), B(o, {
                        extCallback: `ContentScript:DownloadButtonClickCatch_${e.type}`
                    })
                })) : (n = !1, t.classList.remove("downloading"), B("There is no callbackPromise", {})), !1
            }
        }

        function X(e) {
            const t = document.createElement("div");
            try {
                t.classList.add("extension__download_post"), t.classList.add(`${e.type}`), t.setAttribute("title", "Download"), t.setAttribute("data-type", e.type), t.setAttribute("data-code", e.code);
                var n = !1
            } catch (e) {
                B(e, {
                    extCallback: "ContentScript:getDownloadButton"
                })
            }
            return t.onclick = () => (W(e, t, n), !1), t
        }

        function F(e) {
            return !!e.querySelector(".extension__download_post")
        }

        function Y() {
            const e = N();
            var t, n;
            switch (e[0]) {
                case "stories":
                    n = e[2], t = "highlights" === e[1] ? "highlight" : "story";
                    break;
                case "reel":
                    n = e[1], t = "reel";
                    break;
                case "reels":
                    n = e[1], t = "reels";
                    break;
                case "p":
                    n = e[1], t = "post"
            }
            return t ? {
                code: n,
                type: t
            } : null
        }

        function K(e) {
            var t = e;
            for (let e = 0; e <= 20 && (t && t.querySelector); e++) {
                let e = t.querySelector('a[href*="/p/"],a[href*="/reel/"]');
                if (e) {
                    let t = e.getAttribute("href").split("/").filter((e => "" != e));
                    if (t.length >= 3 && t[1] && ("p" == t[1] || "reel" == t[1])) return {
                        type: "post",
                        code: t[2]
                    };
                    if (t.length >= 2 && t[1] && ("p" === t[0] || "reel" == t[1])) return {
                        type: "post",
                        code: t[1]
                    }
                }
                t = t.parentElement
            }
            return null
        }

        function J() {
            [...document.querySelectorAll("article section.x6s0dn4 > div > span, article section.x78zum5 > span, article button._abl-, section button._abl-, div.x4h1yfo section.x6s0dn4.xrvj5dj.x1o61qjw > div > span")].map((e => 1 == e.parentElement.childElementCount ? e.parentElement.parentElement : e.parentElement)).map((e => {
                if (e && !F(e)) {
                    const n = (t = e, Y() || K(t));
                    if (n) {
                        const t = Math.min(e.childElementCount, 3);
                        e.insertBefore(X(n), e.children[t])
                    }
                }
                var t
            }))
        }
        async function ee() {
            try {
                const e = N();
                2 != e.length && 1 != e.length || "reels" != e[0] ? e.length >= 2 && "stories" == e[0] ? function() {
                    const e = document.querySelectorAll("section.xh8yej3"),
                        t = e.length > 0 ? e[e.length - 1] : null;
                    if (t && !F(t)) {
                        const e = X({
                            type: window && window.location && window.location.pathname && window.location.pathname.startsWith("/stories/highlights/") ? "highlight" : "story",
                            code: null
                        });
                        t.insertAdjacentElement("beforeend", e)
                    }
                }() : J() : function() {
                    const e = [...document.querySelectorAll(".html-div [aria-haspopup]")];
                    e.length, e.map((e => {
                        const t = e.parentElement.parentElement;
                        if (t && !F(t)) {
                            const e = X({
                                type: "reels",
                                code: null
                            });
                            t.insertAdjacentElement("afterbegin", e)
                        }
                    }))
                }(), [...document.querySelectorAll('a[href*="/p/"],a[href*="/reel/"]')].map(((e, t) => {
                    const n = e.parentElement,
                        o = e.getAttribute("href"),
                        a = o.split("/").filter((e => "" != e));
                    if (F(n));
                    else if (!o.startsWith("/reel/") && !o.startsWith("/p/") || o.includes("/comments")) {
                        if ((o.includes("/reel/") || o.includes("/p/")) && !o.includes("/comments")) {
                            const e = X({
                                type: o.includes("/reel/") ? "reel" : "post",
                                code: a[2]
                            });
                            e.classList.add("linkover"), n.insertAdjacentElement("beforeend", e)
                        }
                    } else {
                        const e = X({
                            type: o.startsWith("/reel/") ? "reel" : "post",
                            code: a[1]
                        });
                        e.classList.add("linkover"), n.insertAdjacentElement("beforeend", e)
                    }
                }))
            } catch (e) {
                B(e, {
                    extCallback: "ContentScript:DOMChangeHandler"
                })
            }
        }
        chrome.storage.local.get({
            LastMessageTime: 0,
            DownloadCount: 0,
            DailyDownloadCounts: {}
        }).then((e => {
            e.LastMessageTime && e.LastMessageTime, e.DownloadCount && (Q = e.DownloadCount), j in e.DailyDownloadCounts && e.DailyDownloadCounts[j]
        })), new MutationObserver(ee).observe(document.querySelector("body"), {
            subtree: !0,
            attributes: !1,
            childList: !0
        }), ee(), document.addEventListener("contextmenu", (e => {
            try {
                const t = N(),
                    n = window.location.pathname;
                Z = 2 == t.length && "reels" == t[0] || t.length >= 2 && n.startsWith("/stories/") ? Y() : K(e.target)
            } catch (e) {
                B(e, {
                    extCallback: "ContentScript:contextmenu"
                })
            }
        })), chrome.runtime.onMessage.addListener(((e, t, n) => {
            switch (e.action) {
                case "DOWNLOAD_CURRENT_POST":
                    if (Z) {
                        X(Z).click();
                        break
                    }
            }
        }))
    })()
})();