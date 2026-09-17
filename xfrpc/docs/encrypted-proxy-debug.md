# xfrpc 加密代理(transport.useEncryption)与 UDP 代理问题排查记录

日期:2026-09-07
状态:**已解决**(本机 frps 0.61.1 验证:明文 TCP / `useEncryption` / UDP echo 均通过)

根因与修复见文末 §8。

---

## 1. 问题描述

用官方 frps 做服务端对 xfrpc 做端到端测试:

| 场景 | 结果 |
|---|---|
| TCP 代理(无加密),frps 0.61.1 / 0.31.1 | ✅ 正常(curl 拿到本地 HTTP 页面) |
| TCP 代理 + `transport.useEncryption = true` | ❌ 连接全部建立,但无数据返回,curl 超时 |
| UDP 代理 | ❌ workConn 建立后收到 UDP 包即 `EOF` |

**重要**:(1) 用改动前(`e184e30`)的旧二进制做 A/B,加密与 UDP **同样失败**——是上游既有缺陷,不是近期提交(含 P0/P1 安全修复)引入的回归;(2) 换 frps 0.31.1 老版本结果一致,与 frps 版本无关。

## 2. 测试环境与复现步骤

所有测试在 host(本机)完成,相关文件在 `/tmp/frptest/`:

- frps 0.61.1:`/tmp/frp_0.61.1_linux_amd64/frps`,配置 `/tmp/frptest/frps.toml`:
  `bindAddr=127.0.0.1, bindPort=7000, auth.token="test_token_123"`
- 本地服务:python http.server 监听 127.0.0.1:18888(**测试前必须先起,它挂了会让 workConn 完全不拨**,现象变成"连 workConn 都没有")
- 新版 xfrpc:`/tmp/xfrpcbuild/xfrpc`(含已推送的 P0/P1 修复 commit `012f0fc`)
- 旧版对照:`/tmp/xfrpcoldbuild/xfrpc`(e184e30 构建)

加密配置 `/tmp/frptest/enc-only.toml`:

```toml
serverAddr = "127.0.0.1"
serverPort = 7000
auth.method = "token"
auth.token = "test_token_123"

[[proxies]]
name = "web-enc"
type = "tcp"
localIP = "127.0.0.1"
localPort = 18888
remotePort = 18890
transport.useEncryption = true
```

注意:TOML 键名是驼峰(`serverAddr`/`localIP`/`localPort`),值要加引号;`transport.useEncryption` 是 dotted key。仓库标准范例见 `xfrpc_min.toml`。

### 启动命令

```bash
setsid /tmp/frp_0.61.1_linux_amd64/frps -c /tmp/frptest/frps.toml > /tmp/frptest/frps.log 2>&1 < /dev/null &
setsid python3 -m http.server 18888 --bind 127.0.0.1 > /tmp/frptest/local.log 2>&1 < /dev/null &
setsid /tmp/xfrpcbuild/xfrpc -c /tmp/frptest/enc-only.toml > /tmp/frptest/xfrpc.log 2>&1 < /dev/null &
curl -m 8 http://127.0.0.1:18890/     # 预期:本地页面;实际:超时无响应
```

### 已确认的现象

1. frps 日志:`new proxy [web-enc] success`、`get a user connection` 均正常 → 控制面完全正常
2. xfrpc 侧把**未解密的密文原样转发给了本地服务**。`/tmp/frptest/local.log` 中可见大量 400 错误,请求内容是乱码(密文)——即 frps→xfrpc 方向的数据没有被解密就交给了 local
3. 完成后 xfrpc 会把 local 的响应密文原样发回 frps,frps 侧同样解不出 → 用户侧超时

## 3. 已排除的原因(逐项验证过)

1. **KDF 参数**:frp golib(`fatedier/golib/crypto/encode.go`)与 xfrpc `crypto_stream.c` 完全一致:
   - `PBKDF2-HMAC-SHA1(key=token, salt="crypto", iter=64, dklen=16)`
   - AES-128-CFB(块模式 CFB128,golib 与 OpenSSL `EVP_aes_128_cfb128()` 语义一致)
2. **IV 交换协议**:golib `Writer` 第一次写时先写 16 字节随机 IV;`Reader` 先读 16 字节作为对端 IV。xfrpc `crypto_encode_evbuffer`/`crypto_decode_evbuffer` 的逻辑与此一致
3. **加密顺序**:frp 是先压缩后加密(读方向先解密后解压),xfrpc 相同
4. **TOML 配置解析**:用独立测试程序(`/tmp/tomltest.c`)直接调 `xfrpc_toml_get(sec, "transport.useEncryption")`,返回 `"1"`,`is_true("1")==1`,config.c:1087 的赋值路径无问题
5. **frps 版本**:0.61.1 与 0.31.1 行为一致
6. **近期代码改动**:旧二进制 A/B 失败方式相同,排除回归

## 4. 当前主要疑点(按可能性排序)

### 疑点 A(最可能):运行时 `client->use_encryption` 实际为 0

证据链:
- `start_xfrp_tunnel()`(client.c:361-374)在 `use_encryption=1` 时会打 `LOG_INFO "Proxy [%s] encryption enabled (AES-128-CFB)"`,但**所有日志中从未出现**这条(日志问题见 §5)
- local.log 收到的乱码长度包含头部——如果 xfrpc 原样转发 frps 的密文流(连 IV 一起),正是这种表现
- 若 use_encryption=0:c2s 方向 local 明文响应直接发 frps,frps 按加密流解密 → 用户侧得到垃圾/超时;s2c 方向 frps 密文直接进 local → local.log 的 400 乱码。完全吻合现象

但矛盾点:config 解析单测返回 1,静态检查 `client->use_encryption = ps->use_encryption`(client.c:361)路径正确。
**下一步排查**:在 `start_xfrp_tunnel` 加一条 `fprintf(stderr, "use_enc=%d\n", ps->use_encryption)` 临时打印,或用 gdb 在 client.c:361 断点看值。怀疑点:`get_proxy_service(sr->proxy_name)` 返回的 ps 是否是 TOML 加载的那份(是否存在配置重载/两份配置结构),或 `new_proxy_service` 之后的某个函数把字段清零。

### 疑点 B:tcp_mux 模式下 IV 帧序错乱

xfrpc 默认 `tcp_mux` 开启(测试未显式关闭),加密数据跑在控制连接的 ymux 流里。MITM 抓包(`/tmp/frptest/capture.log`,格式:`连接-方向 长度 hex`,数据被 tmux 帧包裹)已看到:

- S2C stream3:tmux 头 `000000000000000300000010` + 16 字节 `e17e3e8d...`(疑似服务端 IV)→ 下一帧 78 字节密文——**顺序正常**
- C2S stream3 出现 `len=0x71(113)` → `len=0x10(16)` → `len=0x4e(78)` → `len=0x17f(383)` 的帧序,113 字节帧在 16 字节"疑似 IV"帧**之前**——如果 113 字节里含密文,则客户端 IV 发晚了,frps 读流时会错位

**下一步排查**:写脚本按 tmux 帧格式(version(1)|type(1)|flags(2)|stream_id(4)|length(4),type=3 为 PSH)完整重组 capture.log 中 stream3 两个方向的字节流,检查:
1. C2S 第一帧是否 16 字节 IV(`crypto_encode_evbuffer` 中 IV 是 `evbuffer_add` 到 dst 头部,理论上应在最前)
2. 用 Python(`hashlib.pbkdf2_hmac('sha1', b"test_token_123", b"crypto", 64, 16)` + AES-128-CFB)逐方向解密,能解出 `GET / HTTP` 即该方向正确
3. 上一轮已写过一个解析脚本尝试(见会话记录,输出为空未跑通),需要修正:capture.log 的 hex 每行截断到 600/800 字符,长帧会缺尾,重组时要以字节计

### 疑点 C:非 mux 与 mux 路径行为差异

`start_xfrp_tunnel` 中非 mux 模式才给 `client->ctl_bev` 设 `xfrp_worker_event_cb`;mux 模式下 ctl_bev=主控制连接(control.c:332)。可在 TOML 里加 `transport.tcpMux = false`(确认键名)对比测试:若非 mux 加密正常,则问题锁定在 mux 流的加密接线。

### UDP 代理(独立问题)

现象:frps `[udp] read from workConn for udp error: EOF`,workConn 一收到 UDP 包就断。UDP 测试要用**本地 UDP 服务**(如 `/tmp/frptest/udpecho.py`,一个 UDP echo)而非 http.server(TCP)——早先用 http.server 测 UDP 是错误的。UDP 与加密问题独立,优先级低于加密。

## 5. 调试基础设施备注(踩过的坑)

1. **xfrpc 日志**:成功连接后几乎不输出日志(连 -d 7 也是),只有错误才出;daemon 模式(无 -f)makedaemon 会 close stderr,日志全丢。**调试必须加 `-f -d 7` 且用 `> file 2>&1` 捕获**。若要详细日志,直接在可疑路径加 `fprintf(stderr,...)` 临时打印最可靠
2. **frps 日志**:在 stdout,`/tmp/frptest/frps.log`
3. **shell pkill 自杀陷阱**:`pkill -f <模式>` 会匹配到自己所在的 bash 命令行,反复导致测试脚本静默死亡。规避:用 `pkill -x xfrpc` / `pkill -x frps` / `pkill -f "[m]itm.py"`(正则技巧),且分步执行
4. **`cd dir && setsid xxx &`**:后台化会把 `cd` 一起带进子 shell,父 shell cwd 不变,后续命令用相对路径会找不到文件——**一律用绝对路径**
5. MITM 抓包工具:`/tmp/frptest/mitm3.py`(监听 7300 转发 7000,所有字节 hex 记录到 `/tmp/frptest/capture.log`);xfrpc 配置 `serverPort = 7300` 走 MITM(`/tmp/frptest/enc-mitm.toml`)
6. 测试服务器进程清理:`pkill -x xfrpc; pkill -x frps`,本地服务 `pkill -f "[h]ttp.server 18888"`

## 6. 相关代码位置

- 加密实现:`crypto_stream.c`(KDF/加解密/IV,与 golib 对齐,已验证参数一致)
- 接线:`client.c:355-375`(use_encryption 从 ps 拷贝 + crypto ctx 创建)、`proxy_tcp.c:437-540`(crypto_encode/decode_evbuffer)、`proxy_tcp.c:576/665`(c2s/s2c 调用点)
- TOML 解析:`config.c:1037-1120`(load_toml_proxies)、`toml_parser.c`(dotted key seek,已单测通过)
- frp 参照:`fatedier/frp client/proxy/proxy.go HandleTCPWorkConnection`、`fatedier/golib io/io.go WithEncryption`、`crypto/encode.go`+`decode.go`(协议权威定义)

## 7. 建议的排查顺序(给下次接手的人)

1. **先做疑点 A**:gdb/临时打印确认运行时 `ps->use_encryption` 与 `client->use_encryption` 的值(5 分钟)。若为 0,沿 `load_toml_proxies → validate → get_proxy_service → start_xfrp_tunnel` 查字段被谁清掉
2. 若为 1,做**疑点 B**:修好 tmux 重组脚本,检查 stream3 C2S 首帧是否为 16 字节 IV;并用 Python 按 golib 参数解密两个方向
3. **疑点 C**:加 `transport.tcpMux = false` 对比,缩小到 mux 层还是流加密层
4. 加密修好后,用同样方法查 UDP(抓 workConn 上 UDP 包的 tmux 帧,frps 报 EOF 时的时序)
5. 全部通过后:把手工测试固化成 CI 端到端脚本(frps + xfrpc + curl 断言,覆盖非加密/加密/UDP 三场景)

## 8. 结论(2026-09-07)

疑点 A 不成立:运行时 `use_encryption=1`,TOML 解析正确。

加密失败的真实原因:

1. **KDF salt**:golib 默认 `DefaultSalt="crypto"`,但 **frps/frpc `init()` 会改成 `"frp"`**。xfrpc 必须用 salt `"frp"` 才能解出 frps 的 AES-128-CFB 流。
2. **mux 快路径绕过解密**:`tcpmux.c process_data()` 在 `local_proxy_bev` 已建立时把帧 `evbuffer_zc_transfer` 到本地,从不走 `tcp_proxy_s2c_cb`/`proxy_crypto_decode_evbuffer`。密文(含 IV)被原样交给 HTTP 服务。已改为加密/压缩时先 decode 再转发。

UDP 失败的真实原因(与加密独立):

1. mux 同样把 TypeUDPPacket 当原始字节转给 UDP socket,而不是 `handle_frps_msg`。
2. C2S 只写了 JSON,没有 `msg_hdr`(type `'u'` + length);frps 解析失败后 EOF。
3. UDP `bufferevent` 的 `BEV_EVENT_ERROR` 被当成断线,关掉 workConn。
4. 回程 base64 未 NUL 结尾,JSON 内容损坏;未记住用户 `raddr`,回包无法回到调用方。
5. 本地 UDP 套接字未 `connect()`/`send()` 到 echo 服务。

本机验证(frps 0.61.1 + python http.server:18888 + udpecho:18885):

- 明文 TCP `18889` → `hello-xfrpc-enc`
- `transport.useEncryption=true` TCP `18890` → `hello-xfrpc-enc`
- UDP `18892` → `ECHO:ping-udp`
