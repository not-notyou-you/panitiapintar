"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  changeMemberRoleAction,
  inviteMemberAction,
  removeMemberAction,
} from "@/app/(internal)/admin/actions";
import { Button } from "@/components/internal/ui/Button";
import { CopyButton } from "@/components/internal/ui/CopyButton";

export interface MemberItem {
  user_id: string;
  role: "admin" | "member";
  email: string;
  display_name: string | null;
}

export function MembersPanel({
  committeeId,
  members,
  selfId,
}: {
  committeeId: string;
  members: MemberItem[];
  selfId: string;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  // Shown once after creating a new account; held in state only, gone on reload.
  const [newAccount, setNewAccount] = useState<{ email: string; password: string } | null>(null);
  const admins = members.filter((m) => m.role === "admin").length;

  const report = (
    r: { ok: true } | { ok: false; error: { message: string; requestId: string } },
    okText: string,
  ) => {
    setMsg(
      r.ok
        ? { ok: true, text: okText }
        : { ok: false, text: `${r.error.message} (kode ${r.error.requestId})` },
    );
    if (r.ok) router.refresh();
  };

  return (
    <div className="flex flex-col gap-4">
      <form
        className="flex flex-col gap-2 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await inviteMemberAction({ committeeId, email, role });
            const created = r.ok && r.data.tempPassword ? r.data.tempPassword : null;
            report(r, created ? "Akun baru dibuat dan ditambahkan." : "Anggota ditambahkan.");
            setNewAccount(created ? { email, password: created } : null);
            if (r.ok) setEmail("");
          });
        }}
      >
        <label className="label flex-1">
          Email anggota
          <input
            className="field"
            type="email"
            required
            maxLength={254}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="anggota@contoh.test"
          />
        </label>
        <label className="label">
          Peran
          <select
            className="field"
            value={role}
            onChange={(e) => setRole(e.target.value as "admin" | "member")}
          >
            <option value="member">Anggota</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <Button type="submit" disabled={pending}>
          Tambah
        </Button>
      </form>
      {msg ? (
        <p role="status" className={`${msg.ok ? "notice" : "pii"} m-0`}>
          {msg.text}
        </p>
      ) : null}

      {newAccount ? (
        <div role="status" className="notice m-0 flex flex-col gap-1 text-xs">
          <span>
            Berikan data masuk ini ke <strong>{newAccount.email}</strong>. Kata sandi hanya ditampilkan
            sekali.
          </span>
          <span className="flex flex-wrap items-center gap-2">
            Kata sandi sementara: <code>{newAccount.password}</code>
            <CopyButton value={newAccount.password} />
          </span>
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Nama / email</th>
              <th>Peran</th>
              <th>
                <span className="sr-only">Aksi</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => {
              const lastAdmin = m.role === "admin" && admins <= 1;
              return (
                <tr key={m.user_id}>
                  <td>
                    {m.display_name ? <span className="block">{m.display_name}</span> : null}
                    <span className="text-mut text-xs">{m.email}</span>
                    {m.user_id === selfId ? <span className="text-mut text-xs"> (kamu)</span> : null}
                  </td>
                  <td>
                    <select
                      className="field"
                      aria-label={`Peran ${m.email}`}
                      value={m.role}
                      disabled={pending || lastAdmin}
                      title={lastAdmin ? "Admin terakhir tidak bisa diturunkan" : undefined}
                      onChange={(e) =>
                        start(async () =>
                          report(
                            await changeMemberRoleAction({
                              committeeId,
                              userId: m.user_id,
                              role: e.target.value,
                            }),
                            "Peran diubah.",
                          ),
                        )
                      }
                    >
                      <option value="member">Anggota</option>
                      <option value="admin">Admin</option>
                    </select>
                  </td>
                  <td className="text-right">
                    <Button
                      variant="danger"
                      disabled={pending || lastAdmin}
                      title={lastAdmin ? "Admin terakhir tidak bisa dihapus" : undefined}
                      onClick={() => {
                        if (!window.confirm(`Keluarkan ${m.email} dari kepanitiaan?`)) return;
                        start(async () =>
                          report(
                            await removeMemberAction({ committeeId, userId: m.user_id }),
                            "Anggota dikeluarkan.",
                          ),
                        );
                      }}
                    >
                      Hapus
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
