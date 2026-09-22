import { jsx as _jsx, Fragment as _Fragment } from "react/jsx-runtime";
import { Navigate, useLocation } from 'react-router-dom';
import { ROLE_HOME } from '@/data/auth';
export default function RouteGuard({ current, allow, children, }) {
    const location = useLocation();
    if (!current)
        return _jsx(Navigate, { to: "/login", replace: true, state: { from: location } });
    if (!allow.includes(current.appUser.role))
        return _jsx(Navigate, { to: ROLE_HOME[current.appUser.role], replace: true });
    return _jsx(_Fragment, { children: children });
}
