import { useAuth } from "../../../auth/AuthProvider";
import { ROLE_LABEL } from "../../../auth/roles";
import { ConsolePage } from "../../../components/console/ConsolePage";
import { Alert } from "../../../components/ui/Alert";
import {
  PERMISSION_GROUP_LABEL,
  PERMISSIONS,
  type PermissionGroup,
} from "../../../console/access";
import { useOrg } from "../../../console/useOrg";
import {
  Devices,
  Notifications,
  Organisations,
  Password,
  Profile,
  rolesOf,
} from "../../AccountPage";
import "../../Account.css";
import "./Manage.css";

const GROUPS = Object.keys(PERMISSION_GROUP_LABEL) as PermissionGroup[];

/**
 * /o/:slug/profile: your own account inside the organisation's console —
 * name, password, where you're signed in, your emails — and what your role
 * lets you do here. /account sends people with one organisation here.
 */
export default function ProfilePage() {
  const { user, impersonator } = useAuth();
  const { org, access } = useOrg();
  if (!user) return null;
  const mine = [...access.perms];
  return (
    <ConsolePage
      kicker="Account"
      title="Your account"
      docTitle="Your account"
      lede={
        <p>
          Your name, password, where you’re signed in, the emails you get, and
          what you can do in {org.orgName}.
        </p>
      }
    >
      <div className="acct__main prof">
        <section className="acct-card" aria-labelledby="prof-role">
          <h2 className="acct-card__title" id="prof-role">
            Your role in {org.orgName}
          </h2>
          <p>
            <span className={`status-chip team-role team-role--${org.role}`}>
              {ROLE_LABEL[org.role]}
            </span>
          </p>
          <div className="prof-perms-grid">
            {GROUPS.map((g) => {
              const here = mine.filter((p) => PERMISSIONS[p].group === g);
              return here.length ? (
                <div key={g} className="prof-perms">
                  <h3 className="prof-perms__title">
                    {PERMISSION_GROUP_LABEL[g]}
                  </h3>
                  <ul>
                    {here.map((p) => (
                      <li key={p}>{PERMISSIONS[p].label}</li>
                    ))}
                  </ul>
                </div>
              ) : null;
            })}
          </div>
          <p className="row__meta">
            An owner or admin changes roles and permissions, from Team.
          </p>
        </section>
        {impersonator ? (
          <Alert tone="info" title={`You're acting as ${user.name}`}>
            <p>
              Their name, password, signed-in browsers and emails are theirs to
              change. Stop acting to see your own account.
            </p>
          </Alert>
        ) : (
          <>
            <Profile user={user} />
            <Password email={user.email} />
            <Devices />
            <Notifications who={rolesOf(user)} />
          </>
        )}
        <Organisations user={user} />
      </div>
    </ConsolePage>
  );
}
