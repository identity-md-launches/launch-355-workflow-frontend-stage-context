import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useAccount, useConnect, useDisconnect, useWalletClient } from "wagmi";
import { encodeAbiParameters, type Address, type Hex } from "viem";
import { protocol, type Runtime } from "./config";
import {
  errorMessage,
  inputAmount,
  priceLimit,
  readActivity,
  readSnapshot,
  short,
  swapArgs,
  units,
  verifyChain,
  type Snapshot,
} from "./chain";

const names = ["Explorer", "Regular", "Insider", "Loyalist"];
type Quote = {
  out: bigint;
  amount: bigint;
  buy: boolean;
  limit: bigint;
  expires: number;
  account: Address;
  bps: number;
};
export function App({ r }: { r: Runtime }) {
  const { address, chainId, connector, isConnected } = useAccount();
  const { connectAsync, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const { data: wallet } = useWalletClient({
    chainId,
    query: { enabled: isConnected && chainId === r.d.chainId },
  });
  const [data, setData] = useState<Snapshot>();
  const [verified, setVerified] = useState(false),
    [loading, setLoading] = useState(true),
    [readError, setReadError] = useState("");
  const [activity, setActivity] =
      useState<Awaited<ReturnType<typeof readActivity>>>(),
    [eventError, setEventError] = useState("");
  const [buy, setBuy] = useState(true),
    [amount, setAmount] = useState(""),
    [tolerance, setTolerance] = useState("0.5"),
    [quote, setQuote] = useState<Quote>();
  const [busy, setBusy] = useState(""),
    [status, setStatus] = useState(""),
    [error, setError] = useState(""),
    [fieldError, setFieldError] = useState(""),
    [hash, setHash] = useState<Hex>(),
    [now, setNow] = useState(Date.now());
  const [burnConsent, setBurnConsent] = useState(false);
  const amountRef = useRef<HTMLInputElement>(null),
    lock = useRef(false),
    generation = useRef(0);
  const current = useRef({ address, chainId, buy, amount, tolerance });
  current.current = { address, chainId, buy, amount, tolerance };
  const explorer = r.d.network.explorer;
  const sameAccount = data?.account?.toLowerCase() === address?.toLowerCase();
  const fresh = !!data && sameAccount && now - data.time < 60000;
  const ready =
    verified &&
    fresh &&
    isConnected &&
    chainId === r.d.chainId &&
    !loading &&
    !!wallet;
  const owned = data && sameAccount && address;
  const quoteValid =
    !!quote &&
    quote.expires > now &&
    quote.account === address &&
    quote.buy === buy;
  const needsApproval =
    !!quote && quoteValid && !buy && !!data && data.allowance < quote.amount;
  const disabled = !!busy;
  const effectiveBps = data?.contractWallet ? 100 : (data?.bps ?? 100);
  const accountKey = address;
  const refresh = useCallback(async () => {
    const ticket = ++generation.current;
    setLoading(true);
    setReadError("");
    setVerified(false);
    try {
      await verifyChain(r);
      const next = await readSnapshot(r, accountKey);
      if (ticket !== generation.current) return;
      setData(next);
      setVerified(true);
      readActivity(r, next.block)
        .then((v) => {
          if (ticket === generation.current) {
            setActivity(v);
            setEventError("");
          }
        })
        .catch((e) => {
          if (ticket === generation.current) setEventError(errorMessage(e));
        });
    } catch (e) {
      if (ticket === generation.current) {
        setReadError(errorMessage(e));
        setData(undefined);
      }
    } finally {
      if (ticket === generation.current) setLoading(false);
    }
  }, [r, accountKey]);
  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 45000);
    return () => {
      generation.current++;
      clearInterval(id);
    };
  }, [refresh]);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    setQuote(undefined);
    setFieldError("");
    setError("");
    setBurnConsent(false);
  }, [address, chainId, buy, amount, tolerance]);
  useEffect(() => {
    setStatus("");
    setHash(undefined);
  }, [address, chainId]);
  async function task(label: string, fn: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(label);
    setError("");
    setStatus("");
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e, r.hook.abi));
    } finally {
      lock.current = false;
      setBusy("");
    }
  }
  async function connectWallet() {
    await task("Connecting", async () => {
      const selected =
        connectors.find((c) => c.id !== "injected") ?? connectors[0];
      if (!selected || !(await selected.getProvider()))
        throw Error(
          "No browser wallet found. Install a compatible Ethereum wallet, then reload this page.",
        );
      await connectAsync({ connector: selected });
      setStatus("Wallet connected. Loading your onchain tier.");
    });
  }
  async function switchNetwork() {
    await task("Switching network", async () => {
      const p = (await connector?.getProvider()) as
        | {
            request: (a: {
              method: string;
              params: unknown[];
            }) => Promise<unknown>;
          }
        | undefined;
      if (!p) throw Error("Reconnect your wallet to switch networks.");
      const hex = r.d.walletAddChain.chainId;
      try {
        await p.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: hex }],
        });
      } catch (e) {
        const x = e as {
          code?: number;
          message?: string;
          data?: { originalError?: { code?: number } };
        };
        if (
          x.code !== 4902 &&
          x.data?.originalError?.code !== 4902 &&
          !/unknown chain|unrecognized chain|not added/i.test(x.message || "")
        )
          throw e;
        await p.request({
          method: "wallet_addEthereumChain",
          params: [r.d.walletAddChain],
        });
        await p.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: hex }],
        });
      }
      setStatus(`Switched to ${r.d.network.name}.`);
    });
  }
  async function requireWallet() {
    if (!wallet || !address || chainId !== r.d.chainId || !ready)
      throw Error(
        "Connect on the deployment network and refresh live state first.",
      );
    const accounts = await wallet.getAddresses();
    const id = await wallet.getChainId();
    if (
      id !== r.d.chainId ||
      accounts[0]?.toLowerCase() !== address.toLowerCase()
    )
      throw Error(
        "Wallet account or network changed. Reconnect and review again.",
      );
    await verifyChain(r);
    if (
      current.current.address !== address ||
      current.current.chainId !== chainId
    )
      throw Error("Wallet changed during verification. Review again.");
    return { wallet, address };
  }
  async function getQuote(e: FormEvent) {
    e.preventDefault();
    if (disabled) return;
    setFieldError("");
    let n: bigint;
    try {
      n = inputAmount(
        amount,
        buy
          ? r.d.network.nativeCurrency.decimals
          : (data?.decimals ?? r.d.token.decimals),
      );
    } catch (e) {
      setFieldError(errorMessage(e));
      amountRef.current?.focus();
      return;
    }
    await task("Getting quote", async () => {
      if (!ready || !address || !data)
        throw Error(
          "Connect on Sepolia and refresh live state to get a quote.",
        );
      if (data.contractWallet)
        throw Error(
          "This form supports direct EOA transactions. Use an account without contract code.",
        );
      setQuote(undefined);
      const state = await readSnapshot(r, address);
      const bps = Math.round(Number(tolerance) * 100);
      const limit = priceLimit(state.price, buy, bps);
      if (n > (buy ? state.eth : state.balance))
        throw Error(
          `Insufficient ${buy ? "ETH" : "TIER"} balance. Add test funds and try again.`,
        );
      if (!state.price)
        throw Error(
          "The pool is not initialized. Try again after initialization.",
        );
      const result = await r.client.simulateContract({
        address: r.d.network.uniswapV4.quoter,
        abi: protocol.quoter,
        functionName: "quoteExactInputSingle",
        args: [
          {
            poolKey: r.poolKey,
            zeroForOne: buy,
            exactAmount: n,
            hookData: encodeAbiParameters([{ type: "address" }], [address]),
          },
        ],
        account: address,
        blockNumber: state.block,
      });
      if (result.result[0] <= 0n)
        throw Error("The quote returns no output. Try a different amount.");
      if (
        current.current.address !== address ||
        current.current.chainId !== chainId ||
        current.current.amount !== amount ||
        current.current.buy !== buy ||
        current.current.tolerance !== tolerance
      )
        throw Error("Trade changed while quoting. Review it again.");
      setData(state);
      setNow(Date.now());
      setQuote({
        out: result.result[0],
        amount: n,
        buy,
        limit,
        expires: Date.now() + 60000,
        account: address,
        bps: state.contractWallet ? 100 : state.bps,
      });
      setStatus("Quote ready. Review the details before continuing.");
    });
  }
  async function confirmed(tx: Hex, label: string) {
    setHash(tx);
    setStatus(`${label} submitted. Waiting for confirmation…`);
    const receipt = await r.client.waitForTransactionReceipt({
      hash: tx,
      timeout: 180000,
    });
    if (receipt.status !== "success")
      throw Error(
        `${label} reverted onchain. Inspect the transaction, refresh and try again.`,
      );
    setStatus(`${label} confirmed.`);
    await refresh();
  }
  async function approve() {
    await task("Approving TIER", async () => {
      const { wallet, address } = await requireWallet();
      if (!quote || quote.expires <= Date.now() || quote.buy)
        throw Error("Get a fresh sell quote first.");
      const simulation = await r.client.simulateContract({
        address: r.token.address,
        abi: r.token.abi,
        functionName: "approve",
        args: [r.d.routing.poolSwapTest, quote.amount],
        account: address,
      });
      if (simulation.result !== true)
        throw Error("Token approval simulation did not succeed.");
      await confirmed(
        await wallet.writeContract({
          ...simulation.request,
          chain: r.chain,
          account: address,
        }),
        "Approval",
      );
    });
  }
  async function swap() {
    await task("Simulating swap", async () => {
      const { wallet, address } = await requireWallet();
      if (!quote || quote.expires <= Date.now() || !quoteValid)
        throw Error("Quote expired. Get a fresh quote.");
      const state = await readSnapshot(r, address);
      if ((state.contractWallet ? 100 : state.bps) !== quote.bps)
        throw Error("Your fee changed. Get a fresh quote.");
      if (!buy && state.allowance < quote.amount)
        throw Error("Approve the sell amount before swapping.");
      if (
        current.current.amount !== amount ||
        current.current.buy !== buy ||
        current.current.tolerance !== tolerance
      )
        throw Error("Trade changed. Get a fresh quote.");
      const simulated = await r.client.simulateContract({
        address: r.d.routing.poolSwapTest,
        abi: protocol.router,
        functionName: "swap",
        args: swapArgs(r, address, quote.buy, quote.amount, quote.limit),
        value: quote.buy ? quote.amount : 0n,
        account: address,
      });
      if (
        quote.expires <= Date.now() ||
        current.current.address !== address ||
        current.current.chainId !== r.d.chainId
      )
        throw Error(
          "Quote or wallet changed during simulation. Get a fresh quote.",
        );
      setBusy("Confirm in wallet");
      await confirmed(
        await wallet.writeContract({
          ...simulated.request,
          chain: r.chain,
          account: address,
        }),
        "Swap",
      );
      setQuote(undefined);
      setAmount("");
    });
  }
  async function burn() {
    await task("Burning accrued fees", async () => {
      const { wallet, address } = await requireWallet();
      if (!burnConsent) throw Error("Confirm the irreversible fee burn first.");
      const simulation = await r.client.simulateContract({
        address: r.hook.address,
        abi: r.hook.abi,
        functionName: "burnFees",
        account: address,
      });
      await confirmed(
        await wallet.writeContract({
          ...simulation.request,
          chain: r.chain,
          account: address,
        }),
        "Fee burn",
      );
      setBurnConsent(false);
    });
  }
  const price =
    data && data.price > 0n
      ? (Number(data.price) ** 2 / 2 ** 192) *
        10 ** (r.d.network.nativeCurrency.decimals - data.decimals)
      : undefined;
  const next = owned && data.next > data.volume ? data.next - data.volume : 0n;
  const progress = owned
    ? data.next === 0n
      ? 100
      : Math.min(100, Number((data.volume * 10000n) / data.next) / 100)
    : 0;
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="header wrap">
        <a href="#main" className="brand" aria-label="Tiers home">
          <span className="mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          tiers<span className="brand-dot">.</span>
        </a>
        <div className="header-actions">
          <span className="network-pill">
            <span aria-hidden="true">◉</span> {r.d.network.name} testnet
          </span>
          {isConnected ? (
            <button disabled={disabled} onClick={() => disconnect()}>
              Disconnect {short(address!)}
            </button>
          ) : (
            <button disabled={disabled} onClick={connectWallet}>
              Connect wallet <span aria-hidden="true">↗</span>
            </button>
          )}
        </div>
      </header>
      <main id="main" className="wrap">
        <section className="intro">
          <p className="eyebrow">An experiment in onchain loyalty</p>
          <h1>
            A little loyalty.
            <br />
            <span>A lower fee.</span>
          </h1>
          <p>
            Swap TIER, build your lifetime volume, and pay less on your next
            swap. Four tiers. One pool. All onchain.
          </p>
          <div className="test-note">
            <span aria-hidden="true">↳</span> A Sepolia test toy. TIER has no
            value or promised return.
          </div>
        </section>
        <div className="workspace">
          <section className="trade panel" aria-labelledby="trade-title">
            <div className="section-top">
              <h2 id="trade-title">Make a swap</h2>
              <span className="quiet">ETH / TIER</span>
            </div>
            <div className="segmented" role="group" aria-label="Swap direction">
              <button
                type="button"
                disabled={disabled}
                aria-pressed={buy}
                onClick={() => setBuy(true)}
              >
                Buy TIER
              </button>
              <button
                type="button"
                disabled={disabled}
                aria-pressed={!buy}
                onClick={() => setBuy(false)}
              >
                Sell TIER
              </button>
            </div>
            <form onSubmit={getQuote} noValidate>
              <div className="amount-box">
                <label htmlFor="amount">You pay</label>
                <div className="amount-row">
                  <input
                    ref={amountRef}
                    id="amount"
                    name="amount"
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="0.00"
                    value={amount}
                    disabled={disabled}
                    onChange={(e) => setAmount(e.target.value)}
                    aria-invalid={!!fieldError}
                    aria-describedby="amount-help amount-error"
                  />
                  <span className="currency">
                    <span aria-hidden="true">{buy ? "Ξ" : "T"}</span>{" "}
                    {buy ? "ETH" : "TIER"}
                  </span>
                </div>
                <p id="amount-help" className="quiet">
                  Balance:{" "}
                  {owned
                    ? units(
                        buy ? data.eth : data.balance,
                        buy ? 18 : data.decimals,
                      )
                    : "—"}{" "}
                  {buy ? "ETH" : "TIER"}
                  {buy ? " · keep ETH for gas" : ""}
                </p>
              </div>
              <p
                id="amount-error"
                className="error"
                role={fieldError ? "alert" : undefined}
              >
                {fieldError}
              </p>
              <div className="receive-box">
                <span className="quiet">Estimated receive</span>
                <strong>
                  {quoteValid
                    ? units(quote!.out, buy ? data?.decimals : 18)
                    : "—"}{" "}
                  <span>{buy ? "TIER" : "ETH"}</span>
                </strong>
                <span className="quiet">
                  {quoteValid
                    ? "Includes LP and hook fees"
                    : "Get a quote from the live pool"}
                </span>
              </div>
              <div className="limit-row">
                <label htmlFor="limit">Pool-price movement limit</label>
                <select
                  id="limit"
                  value={tolerance}
                  disabled={disabled}
                  onChange={(e) => setTolerance(e.target.value)}
                >
                  <option value="0.1">0.1%</option>
                  <option value="0.5">0.5%</option>
                  <option value="1">1%</option>
                  <option value="3">3%</option>
                  <option value="5">5%</option>
                </select>
              </div>
              <dl className="trade-facts">
                <div>
                  <dt>Next swap hook fee</dt>
                  <dd>
                    {owned
                      ? `${(effectiveBps / 100).toFixed(2)}%`
                      : "Connect to see"}
                  </dd>
                </div>
                <div>
                  <dt>Pool LP fee</dt>
                  <dd>{data ? `${(data.lpFee / 10000).toFixed(2)}%` : "—"}</dd>
                </div>
                {quoteValid && buy && (
                  <div>
                    <dt>Hook fee included in payment</dt>
                    <dd>
                      {units(
                        (quote!.amount * BigInt(quote!.bps)) / 10000n,
                        18,
                        18,
                      )}{" "}
                      ETH
                    </dd>
                  </div>
                )}
                {quoteValid && (
                  <div>
                    <dt>Quote expires in</dt>
                    <dd>
                      {Math.max(0, Math.ceil((quote!.expires - now) / 1000))}s
                    </dd>
                  </div>
                )}
              </dl>
              {!isConnected ? (
                <button
                  type="button"
                  className="primary full"
                  disabled={disabled}
                  onClick={connectWallet}
                >
                  Connect wallet to swap <span aria-hidden="true">↗</span>
                </button>
              ) : chainId !== r.d.chainId ? (
                <button
                  type="button"
                  className="primary full"
                  disabled={disabled}
                  onClick={switchNetwork}
                >
                  Switch to {r.d.network.name}
                </button>
              ) : (
                <button
                  className={quoteValid ? "full" : "primary full"}
                  disabled={
                    disabled || !ready || !data?.price || data?.contractWallet
                  }
                >
                  {busy === "Getting quote"
                    ? "Getting quote…"
                    : quoteValid
                      ? "Refresh quote"
                      : "Get quote"}{" "}
                  <span aria-hidden="true">→</span>
                </button>
              )}
            </form>
            {quoteValid && (
              <div className="swap-step">
                {needsApproval ? (
                  <>
                    <p>
                      Step 1 of 2 · Approve exactly{" "}
                      {units(quote!.amount, data?.decimals)} TIER for
                      PoolSwapTest.
                    </p>
                    <button
                      className="primary full"
                      disabled={disabled || !ready}
                      onClick={approve}
                    >
                      Approve TIER
                    </button>
                  </>
                ) : (
                  <>
                    <p>
                      {buy ? "Ready to buy" : "Step 2 of 2 · Ready to sell"}.
                      The wallet will request a signature after simulation.
                    </p>
                    <button
                      className="primary full"
                      disabled={disabled || !ready}
                      onClick={swap}
                    >
                      {busy || `Confirm ${buy ? "buy" : "sell"}`}
                    </button>
                  </>
                )}
              </div>
            )}
            {quote && !quoteValid && (
              <p className="notice">
                Quote expired. Get a fresh quote to continue.
              </p>
            )}
            {isConnected && chainId !== r.d.chainId && (
              <p className="notice">
                Wrong network. Your wallet must use {r.d.network.name}.
              </p>
            )}
            {!loading && data && !data.price && (
              <p className="notice">
                The pool is not initialized. Swaps are unavailable.
              </p>
            )}
            {!loading && data && data.price > 0n && !data.liquidity && (
              <p className="notice">
                No liquidity at the current tick. Get a quote to check whether
                your swap can reach a funded range.
              </p>
            )}
            {owned && data.contractWallet && (
              <p className="notice">
                This form supports direct EOA transactions. Relayed smart
                wallets cannot earn a discount; swaps from accounts with
                contract code are unavailable here.
              </p>
            )}
            {!fresh && data && (
              <p className="notice">
                Live state is stale. Refresh before continuing.
              </p>
            )}
            <p className="form-note">
              The limit caps movement from the quoted pool price, including your
              trade’s price impact. A partial fill reverts. This test router has
              no minimum-output or transaction-expiry parameter.
            </p>
          </section>
          <section className="loyalty panel" aria-labelledby="loyalty-title">
            <div className="section-top">
              <h2 id="loyalty-title">Your standing</h2>
              <span className="eyebrow">Lifetime · this pool</span>
            </div>
            <div className="standing">
              <div>
                <p className="quiet">
                  {owned ? "Current tier" : "Connect to reveal your tier"}
                </p>
                <strong className="tier-name">
                  {owned ? names[data.tier] : "Start exploring"}
                </strong>
                <p>
                  {owned
                    ? `Tier ${data.tier} / 3`
                    : "Every wallet starts at tier 0."}
                </p>
              </div>
              <div className="tier-art" aria-hidden="true">
                <span>Ⅰ</span>
                <span>Ⅱ</span>
                <span>Ⅲ</span>
                <span>Ⅳ</span>
              </div>
            </div>
            <div className="volume-row">
              <span className="quiet">Lifetime ETH volume</span>
              <strong>
                {owned ? units(data.volume) : "—"} <small>ETH</small>
              </strong>
            </div>
            <progress
              max="100"
              value={progress}
              aria-label="Progress to next tier"
            />
            <p className="progress-label">
              {owned
                ? data.next === 0n
                  ? "You have reached the highest tier."
                  : `${units(next)} ETH to ${names[data.tier + 1]}`
                : "Connect your wallet to see your progress."}
            </p>
            <table className="tiers">
              <caption>Less fee, with every tier</caption>
              <thead>
                <tr>
                  <th scope="col">Tier</th>
                  <th scope="col">ETH volume</th>
                  <th scope="col">Hook fee</th>
                </tr>
              </thead>
              <tbody>
                {names.map((name, i) => (
                  <tr
                    key={name}
                    className={owned && data.tier === i ? "current" : ""}
                  >
                    <th scope="row">
                      <span className="tier-number">0{i}</span>
                      {name}
                      {owned && data.tier === i && (
                        <span className="current-label">Current</span>
                      )}
                    </th>
                    <td>
                      {i === 0
                        ? "0"
                        : data
                          ? units(data.thresholds[i - 1])
                          : "—"}
                      {i > 0 ? " +" : ""}
                    </td>
                    <td>{((100 - i * 25) / 100).toFixed(2)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="form-note">
              Your swap uses your tier <strong>before</strong> its volume is
              added. A threshold-crossing swap unlocks the lower fee for the
              next one.
            </p>
          </section>
        </div>
        <div className="feedback">
          <p role="status">{busy ? `${busy}…` : status}</p>
          {hash && (
            <a href={`${explorer}/tx/${hash}`} target="_blank" rel="noreferrer">
              View transaction {short(hash)} ↗
            </a>
          )}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
        </div>
        <section className="pool-strip" aria-label="Live pool state">
          <div>
            <span className="eyebrow">Pool price</span>
            <strong>
              {price
                ? `${new Intl.NumberFormat("en", { maximumSignificantDigits: 7 }).format(price)} TIER`
                : "—"}
            </strong>
            <span className="quiet">per 1 ETH · StateView</span>
          </div>
          <div>
            <span className="eyebrow">Connection</span>
            <strong>
              {loading
                ? "Checking chain…"
                : verified
                  ? "Live on Sepolia"
                  : "Reads unavailable"}
            </strong>
            <span className="quiet">
              {data
                ? `Block ${data.block.toLocaleString()}`
                : "Deployment verification required"}
            </span>
          </div>
          <button disabled={loading || disabled} onClick={() => void refresh()}>
            {loading ? "Refreshing…" : "Refresh live state"}{" "}
            <span aria-hidden="true">↻</span>
          </button>
        </section>
        {readError && (
          <p className="notice" role="alert">
            {readError} Use “Refresh live state” to retry.
          </p>
        )}
        <div className="lower-grid">
          <section className="activity" aria-labelledby="activity-title">
            <div className="section-top">
              <h2 id="activity-title">Onchain activity</h2>
              <span className="quiet">Latest 12 events</span>
            </div>
            <p className="quiet">
              {activity
                ? `Blocks ${activity.from.toLocaleString()}–${activity.to.toLocaleString()}. Volume shows the tier after each swap.`
                : "Loading recent pool swaps and fee burns…"}
            </p>
            {eventError ? (
              <p className="notice">
                Activity unavailable: {eventError} Refresh live state to retry.
              </p>
            ) : activity?.items.length ? (
              <ul className="events">
                {activity.items.map((e) => (
                  <li key={`${e.tx}-${e.index}`}>
                    <span className="event-icon" aria-hidden="true">
                      {e.type === "burn" ? "↗" : "⇄"}
                    </span>
                    <div>
                      <strong>
                        {e.type === "burn"
                          ? "Fees burned"
                          : `${short(e.user!)} · tier ${e.tier}`}
                      </strong>
                      <span className="quiet">
                        {units(e.eth)} ETH{" "}
                        {e.type === "burn" ? "sent to dEaD" : "volume added"}
                      </span>
                    </div>
                    <a
                      href={`${explorer}/tx/${e.tx}`}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`View ${e.type} transaction ${e.tx}`}
                    >
                      View ↗
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              activity && (
                <div className="empty">
                  No events in this block window. A confirmed swap will appear
                  here after a refresh.
                </div>
              )
            )}
          </section>
          <section className="burn panel" aria-labelledby="burn-title">
            <span className="eyebrow">Fees, with one destination</span>
            <h2 id="burn-title">
              Send accrued fees
              <br />
              to dEaD.
            </h2>
            <strong className="burn-value">
              {data ? units(data.fees) : "—"} <span>ETH</span>
            </strong>
            <p>
              Anyone can burn the hook’s accrued fees. All ETH goes to the fixed
              burn address. You receive no reward and pay network gas.
            </p>
            <label className="check">
              <input
                type="checkbox"
                checked={burnConsent}
                disabled={disabled}
                onChange={(e) => setBurnConsent(e.target.checked)}
              />
              I understand this transfer is irreversible.
            </label>
            <button
              className="full"
              disabled={disabled || !ready || !data?.fees || !burnConsent}
              onClick={burn}
            >
              Burn accrued fees <span aria-hidden="true">↗</span>
            </button>
            {!ready && (
              <p className="quiet">
                Connect on Sepolia with verified live state to burn fees.
              </p>
            )}
          </section>
        </div>
        <section className="notes">
          <h2>Know the experiment.</h2>
          <div>
            <p>
              <strong>Volume is earned, not free.</strong> Reaching a tier costs
              the swap fees paid along the way. Volume in one pool never
              discounts another. The LP fee is separate from the hook fee.
            </p>
            <p>
              <strong>Your wallet is your identity.</strong> Swaps encode the
              connected address in hookData. The hook credits volume only when
              that claim matches the transaction origin. Relayed or bundled
              smart-contract wallets pay 1% and earn no discount.
              {data?.contractWallet
                ? " Your connected account has contract code; the quote uses the full fee."
                : ""}
            </p>
          </div>
        </section>
        <details className="deployment">
          <summary>Deployment & contract details</summary>
          <p className="quiet">
            Addresses and ABIs loaded from this export’s deployment manifest.
          </p>
          <dl>
            {r.d.contracts.map((c) => (
              <div key={c.name}>
                <dt>{c.name}</dt>
                <dd>
                  <a
                    href={`${explorer}/address/${c.address}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {c.address}
                  </a>{" "}
                  · <a href={`./${c.abiPath}`}>ABI</a>
                </dd>
              </div>
            ))}
            {Object.entries({
              ...r.d.network.uniswapV4,
              poolSwapTest: r.d.routing.poolSwapTest,
            }).map(([name, addr]) => (
              <div key={name}>
                <dt>{name}</dt>
                <dd>
                  <a
                    href={`${explorer}/address/${addr}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {addr}
                  </a>
                </dd>
              </div>
            ))}
            <div>
              <dt>Connected wallet</dt>
              <dd>{address || "Not connected"}</dd>
            </div>
            <div>
              <dt>Pool ID</dt>
              <dd>{r.poolId}</dd>
            </div>
            <div>
              <dt>Source commit</dt>
              <dd>{r.d.sourceCommit}</dd>
            </div>
            <div>
              <dt>Attestation hash</dt>
              <dd>{r.d.attestationHash}</dd>
            </div>
          </dl>
          <a href="./imd-deployment.json">Download deployment manifest</a>
        </details>
      </main>
      <footer className="wrap">
        <a href="#main" className="brand">
          tiers.
        </a>
        <p>Built for curiosity. Only on {r.d.network.name}.</p>
        <a href={r.d.network.faucets[0]} target="_blank" rel="noreferrer">
          Get test ETH ↗
        </a>
      </footer>
    </>
  );
}
