"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { changeMemberRoleAction, inviteMemberAction, removeMemberAction } from "@/app/admin/actions";
import { Button } from "@/components/ui/Button";

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
            report(r, "Undangan dikirim.");
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
          Undang
        </Button>
      </form>
      {msg ? (
        <p role="status" className={`${msg.ok ? "notice" : "pii"} m-0`}>
          {msg.text}
        </p>
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
