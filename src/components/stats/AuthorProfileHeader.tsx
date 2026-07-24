interface Props {
  name: string;
  email: string;
}

export function AuthorProfileHeader({ name, email }: Props) {
  const initial = (name || email || "?").charAt(0).toUpperCase();

  return (
    <div className="flex items-center gap-3 px-4 pt-3 pb-1">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary">
        {initial}
      </div>
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-foreground">
          {name || email}
        </div>
        <div className="truncate text-xs text-muted-foreground">{email}</div>
      </div>
    </div>
  );
}
